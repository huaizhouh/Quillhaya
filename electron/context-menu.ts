import { Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron';
import type { ContextMenuRequest } from '../src/models/schema';

/** Native edit commands keep Chromium selection, clipboard and CodeMirror input events intact. */
export function installContextMenu(window: BrowserWindow, requestFeedback?: (request: ContextMenuRequest) => void) {
  const contents = window.webContents;
  let pending: { id: string; params: ContextMenuParams; timer: ReturnType<typeof setTimeout> } | undefined;
  const clear = () => { if (pending) clearTimeout(pending.timer); pending = undefined; };
  const popup = (params: ContextMenuParams, sentenceId?: string) => {
    if (window.isDestroyed() || contents.isDestroyed()) return;
    const items: MenuItemConstructorOptions[] = [];
    const separator = () => { if (items.length) items.push({ type: 'separator' }); };
    if (process.platform === 'darwin' && params.selectionText.trim() && params.formControlType !== 'input-password') {
      items.push({ label: '查询', click: () => contents.showDefinitionForSelection() });
      separator();
    }
    const { editFlags: flags } = params;
    // Explicit webContents commands honor context editFlags on macOS as well.
    // Native menu roles on macOS ignore the supplied enabled flag.
    const edit = (label: string, accelerator: string, enabled: boolean, click: () => void) => {
      items.push({ label, accelerator, registerAccelerator: false, enabled, click });
    };
    if (params.isEditable) edit('剪切', 'CmdOrCtrl+X', flags.canCut, () => contents.cut());
    if (params.isEditable || params.selectionText) edit('复制', 'CmdOrCtrl+C', flags.canCopy, () => contents.copy());
    if (params.isEditable) {
      edit('粘贴', 'CmdOrCtrl+V', flags.canPaste, () => contents.paste());
      edit('粘贴并匹配样式', 'CmdOrCtrl+Shift+Alt+V', flags.canPaste, () => contents.pasteAndMatchStyle());
    }
    if (params.isEditable || params.selectionText) edit('全选', 'CmdOrCtrl+A', flags.canSelectAll, () => contents.selectAll());
    if (sentenceId) {
      separator();
      items.push({ label: '定位到写作反馈', click: () => contents.send('context-menu:locate-feedback', sentenceId) });
    }
    if (items.at(-1)?.type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup({ window });
  };
  const show = (id: string, sentenceId?: string) => {
    if (!pending || pending.id !== id) return;
    const { params } = pending; clear(); popup(params, sentenceId);
  };
  contents.on('context-menu', (_event, params) => {
    clear();
    if (!requestFeedback) { popup(params); return; }
    const id = crypto.randomUUID();
    // Standard editing remains available if the renderer cannot resolve a sentence.
    pending = { id, params, timer: setTimeout(() => show(id), 500) };
    // Electron reports DIP coordinates; DOM hit testing uses CSS pixels.
    const zoom = contents.getZoomFactor();
    requestFeedback({ id, x: params.x / zoom, y: params.y / zoom });
  });
  window.on('closed', clear);
  return { show };
}
