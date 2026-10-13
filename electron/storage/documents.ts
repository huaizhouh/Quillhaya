import { dialog, type BrowserWindow } from 'electron';
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { WritingDocument } from '../../src/models/schema';
import { AppError } from '../llm/errors';
import type { LocalStore } from './store';

export class Documents {
  private files = new Map<string, { path: string; savedText: string }>();
  constructor(private store: LocalStore, private window: () => BrowserWindow) {}
  async restore() {
    const draft = await this.store.loadDraft();
    if (!draft) return null;
    if (draft.path) this.files.set(draft.document.id, { path: draft.path, savedText: draft.savedText });
    return { ...draft.document, hasFile: Boolean(draft.path) };
  }
  async draft(document: WritingDocument) {
    const file = this.files.get(document.id);
    await this.store.saveDraft({ ...document, hasFile: Boolean(file) }, file?.path ?? null, file?.savedText ?? '');
  }
  async open(): Promise<WritingDocument | null> {
    const result = await dialog.showOpenDialog(this.window(), { title: '打开 Markdown 文档', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    if ((await stat(path)).size > 2_000_000) throw new AppError('file_size', '文件过大，首版支持不超过 500,000 字符的 Markdown 文档。');
    const bytes = await readFile(path);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n'); } catch { throw new AppError('encoding', '文件不是有效 UTF-8，请转换编码后重新打开。'); }
    if (text.length > 500_000) throw new AppError('file_size', '文件超过 500,000 字符，无法打开。');
    const doc: WritingDocument = { id: crypto.randomUUID(), text, task: '', mode: 'discussion', name: basename(path), dirty: false, hasFile: true };
    this.files.set(doc.id, { path, savedText: bytes.toString('utf8') });
    await this.draft(doc);
    return doc;
  }
  async save(document: WritingDocument, saveAs: boolean) {
    const known = this.files.get(document.id);
    let path = saveAs ? undefined : known?.path;
    if (!path) {
      const result = await dialog.showSaveDialog(this.window(), { title: '保存 Markdown 文档', defaultPath: known?.path ?? document.name, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled || !result.filePath) return null;
      path = /\.md$/i.test(result.filePath) ? result.filePath : `${result.filePath}.md`;
      if (path !== result.filePath) {
        try {
          await stat(path);
          const choice = await dialog.showMessageBox(this.window(), { type: 'warning', message: '同名 Markdown 文件已存在', detail: '添加 .md 后缀后的目标文件已存在，是否覆盖？', buttons: ['取消', '覆盖保存'], defaultId: 0, cancelId: 0 });
          if (choice.response !== 1) return null;
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      }
    } else {
      let current: string | null = null;
      try { current = await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      if (current !== null && current !== known?.savedText) {
        const choice = await dialog.showMessageBox(this.window(), { type: 'warning', message: '文件已被其他应用修改', detail: '覆盖会替换磁盘上的版本。也可以取消后使用“另存为”。', buttons: ['取消', '覆盖保存'], defaultId: 0, cancelId: 0 });
        if (choice.response !== 1) return null;
      }
    }
    // Write adjacent, then rename: a failed write never truncates the original.
    const temp = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
    const lineEnding = known?.savedText.includes('\r\n') ? '\r\n' : '\n';
    const savedText = (known?.savedText.startsWith('\uFEFF') ? '\uFEFF' : '') + document.text.replace(/\r\n?|\n/g, lineEnding);
    await writeFile(temp, savedText, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, path);
    this.files.set(document.id, { path, savedText });
    await this.draft({ ...document, name: basename(path), dirty: false });
    return { name: basename(path) };
  }
  async confirmDiscard(): Promise<'save' | 'discard' | 'cancel'> {
    const result = await dialog.showMessageBox(this.window(), { type: 'question', message: '保存当前文档的修改？', detail: '离开当前文档前，可以将内容保存为 Markdown。关闭窗口时仍会保留一份自动草稿。', buttons: ['保存', '不保存', '取消'], defaultId: 0, cancelId: 2 });
    return (['save', 'discard', 'cancel'] as const)[result.response];
  }
}
