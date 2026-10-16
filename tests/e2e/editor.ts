import { expect, type Page } from '@playwright/test';

export async function writeEditor(page: Page, text: string) {
  const editor = page.getByTestId('writing-editor');
  // Use CodeMirror's own select-all handling rather than fill()'s DOM selection,
  // which can race its selection reconciliation after an undo/focus update.
  await editor.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(text);
  await expect(editor).toHaveText(text);
}
