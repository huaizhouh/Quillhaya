import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchIsolated } from './isolated-electron';
import { writeEditor } from './editor';

let app: ElectronApplication, page: Page, directory: string;
const cards = () => page.locator('.feedback-scroll [data-testid="feedback-card"]');
async function launch() {
  app = await launchIsolated(directory); page = await app.firstWindow();
  await expect(page.getByTestId('writing-editor')).toBeVisible();
}
async function quit() {
  const closed = app.waitForEvent('close');
  await app.evaluate(({ app, dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    app.quit();
  }); await closed;
}
async function saveTwo() {
  await writeEditor(page, 'He go home. I am agree with you.');
  await expect(cards().nth(1)).toContainText('建议修改');
  for (let i = 0; i < 2; i++) {
    await cards().nth(i).getByRole('button', { name: '收藏反馈', exact: true }).click();
    await expect(cards().nth(i).getByRole('button', { name: '取消收藏反馈' })).toHaveAttribute('aria-pressed', 'true');
  }
}
async function openFavorites() {
  await page.getByRole('button', { name: '打开收藏夹' }).click();
  return page.getByRole('dialog', { name: '收藏夹', exact: true });
}
test.beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'quillhaya-issue1103-')); await launch(); });
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('issue1103: saves complete feedback, keeps the original snapshot after edits, and restores after quit', async () => {
  await writeEditor(page, 'He go home.');
  await expect(cards().first()).toContainText('建议修改');
  expect(await cards().first().getByRole('button', { name: '复制推荐句' }).evaluate(el => el.nextElementSibling?.getAttribute('aria-label'))).toBe('收藏反馈');
  await page.getByRole('button', { name: '暂停自动分析' }).click();
  await expect(page.getByRole('button', { name: '恢复自动分析' })).toBeVisible();
  await writeEditor(page, 'He go home tomorrow.');
  await expect(cards().first()).toContainText('此前原句：He go home.');
  await cards().first().getByRole('button', { name: '收藏反馈', exact: true }).click();
  await expect(cards().first().getByRole('button', { name: '取消收藏反馈' })).toHaveAttribute('aria-pressed', 'true');
  const saved = JSON.parse(await readFile(join(directory, 'favorites.json'), 'utf8')).items[0];
  expect(saved.result.original_text).toBe('He go home.'); expect(saved.result.suggested_revision).toBe('He goes home.');
  expect(saved.result.issues).toHaveLength(1);
  await quit(); await launch();
  const dialog = await openFavorites();
  await expect(dialog.locator('.original-text')).toHaveText('He go home.');
  await expect(dialog).toContainText(saved.result.overall_explanation_zh);
  await expect(dialog).toContainText(saved.result.issues[0].explanation_zh);
  await expect(dialog).toContainText('模型自报信心');
  await expect(dialog.getByRole('button', { name: '接受修改' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '重新评估' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '复制推荐句' }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('He goes home.');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('writing-editor')).toHaveText('He go home tomorrow.');
});

test('issue1103: newest first, manual ordering across restart, and synchronized removal', async () => {
  await saveTwo();
  let dialog = await openFavorites();
  const originalTexts = () => dialog.locator('.original-text').allTextContents();
  expect(await originalTexts()).toEqual(['I am agree with you.', 'He go home.']);
  await expect(dialog.getByRole('button', { name: '上移收藏' }).first()).toBeDisabled();
  await dialog.getByRole('button', { name: '上移收藏' }).nth(1).click();
  await expect(dialog.getByLabel('收藏排序')).toHaveValue('manual');
  expect(await originalTexts()).toEqual(['He go home.', 'I am agree with you.']);
  await dialog.getByRole('button', { name: '关闭收藏夹' }).click();
  await quit(); await launch(); dialog = await openFavorites();
  await expect(dialog.getByLabel('收藏排序')).toHaveValue('manual');
  expect(await originalTexts()).toEqual(['He go home.', 'I am agree with you.']);
  await dialog.getByLabel('收藏排序').selectOption('newest');
  await expect(dialog.locator('.original-text').first()).toHaveText('I am agree with you.');
  await dialog.getByRole('button', { name: '取消收藏反馈' }).first().click();
  await expect(dialog.getByTestId('favorite-item')).toHaveCount(1);
  await dialog.getByRole('button', { name: '关闭收藏夹' }).click();
  await expect(cards().nth(1).getByRole('button', { name: '收藏反馈', exact: true })).toBeVisible();
  await cards().first().getByRole('button', { name: '取消收藏反馈' }).click();
  dialog = await openFavorites(); await expect(dialog).toContainText('还没有收藏');
  await expect(dialog.getByTestId('favorite-item')).toHaveCount(0);
  expect(JSON.parse(await readFile(join(directory, 'favorites.json'), 'utf8')).items).toEqual([]);
});

test('issue1103: full-document feedback can be saved without a suggested replacement', async () => {
  await writeEditor(page, 'Learning takes practice.');
  await page.getByRole('button', { name: '分析全文', exact: true }).click();
  const full = cards().first(); await expect(full.getByRole('button', { name: '收藏反馈', exact: true })).toBeVisible();
  await full.getByRole('button', { name: '收藏反馈', exact: true }).click();
  await expect(full.getByRole('button', { name: '取消收藏反馈' })).toBeVisible();
  const dialog = await openFavorites(); await expect(dialog).toContainText('全文反馈');
  const saved = JSON.parse(await readFile(join(directory, 'favorites.json'), 'utf8')).items[0];
  expect(saved.scope).toBe('document'); expect(saved.result.suggested_revision).toBeNull();
  await expect(dialog).toContainText(saved.result.overall_explanation_zh);
});

test('issue1103: failed writes do not show a saved heart and can be retried', async () => {
  await writeEditor(page, 'He go home.'); await expect(cards().first()).toContainText('建议修改');
  await mkdir(join(directory, 'favorites.json.tmp'));
  await cards().first().getByRole('button', { name: '收藏反馈', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('收藏夹保存失败');
  await expect(cards().first().getByRole('button', { name: '收藏反馈', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await rm(join(directory, 'favorites.json.tmp'), { recursive: true });
  await cards().first().getByRole('button', { name: '收藏反馈', exact: true }).click();
  await expect(cards().first().getByRole('button', { name: '取消收藏反馈' })).toHaveAttribute('aria-pressed', 'true');
});

test('issue1103: corrupt favorites preserve the source file and do not block writing', async () => {
  await quit(); await writeFile(join(directory, 'favorites.json'), '{broken'); await launch();
  const dialog = await openFavorites(); await expect(dialog.getByRole('alert')).toContainText('原文件已保留');
  expect(await readFile(join(directory, 'favorites.json'), 'utf8')).toBe('{broken');
  await writeFile(join(directory, 'favorites.json'), JSON.stringify({ sort: 'newest', items: [] }));
  await dialog.getByRole('button', { name: '重新加载收藏' }).click();
  await expect(dialog).toContainText('还没有收藏');
  await dialog.getByRole('button', { name: '关闭收藏夹' }).click();
  await writeEditor(page, 'He go home.'); await expect(cards().first()).toContainText('建议修改');
});

test('issue1103: favorites layout supports light/dark themes and rejects invalid IPC input', async () => {
  expect((await page.evaluate(() => window.desktop.addFavorite({ invalid: true } as never))).ok).toBe(false);
  expect((await page.evaluate(() => window.desktop.reorderFavorites({ ids: ['invalid'], sort: 'manual' }))).ok).toBe(false);
  await saveTwo(); await openFavorites();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const dialog = page.getByRole('dialog', { name: '收藏夹', exact: true });
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: join(directory, `favorites-${theme}.png`) });
  }
  await page.getByRole('button', { name: '关闭收藏夹' }).click();
  const actions = cards().first().locator('.card-actions');
  const heights = () => actions.locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  const originalHeights = await heights();
  for (const width of [940, 1150]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 650), width);
    await page.evaluate(() => (document.querySelector('.app-shell') as HTMLElement).style.setProperty('--sidebar-width', '27%'));
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
    expect(await actions.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await heights()).toEqual(originalHeights);
  }
  // Retain only synthetic screenshots outside the temporary user data for visual review.
  const fs = await import('node:fs/promises');
  for (const theme of ['light', 'dark']) await fs.copyFile(join(directory, `favorites-${theme}.png`), join(tmpdir(), `quillhaya-issue1103-${theme}.png`));
});
