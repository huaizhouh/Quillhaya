import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import type { ContextMenuRequest } from '../../src/models/schema';
const menu = vi.hoisted(() => ({ buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) }));
vi.mock('electron', () => ({ Menu: menu }));
import { installContextMenu } from '../../electron/context-menu';

const params = { x: 125, y: 250, isEditable: true, selectionText: 'writing', formControlType: 'none', editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } } as ContextMenuParams;
function fixture() {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, getZoomFactor: () => 1.25 });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  const request = vi.fn<(request: ContextMenuRequest) => void>();
  return { window, contents, request, controller: installContextMenu(window as unknown as BrowserWindow, request) };
}
afterEach(() => { vi.useRealTimers(); menu.buildFromTemplate.mockClear(); });
describe('native context menu lifecycle', () => {
  it('falls back to native editing if the renderer does not answer and ignores late responses', () => {
    vi.useFakeTimers(); const f = fixture(); f.contents.emit('context-menu', {}, params);
    expect(f.request.mock.calls[0][0]).toMatchObject({ x: 100, y: 200 });
    expect(menu.buildFromTemplate).not.toHaveBeenCalled(); vi.advanceTimersByTime(500);
    expect(menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    f.controller.show(f.request.mock.calls[0][0].id, 'late-sentence'); expect(menu.buildFromTemplate).toHaveBeenCalledTimes(1);
  });
  it('rejects stale menu tokens and clears pending callbacks when the window closes', () => {
    vi.useFakeTimers(); const f = fixture(); f.contents.emit('context-menu', {}, params);
    const old = f.request.mock.calls[0][0].id; f.contents.emit('context-menu', {}, params);
    f.controller.show(old, 'old-sentence'); expect(menu.buildFromTemplate).not.toHaveBeenCalled();
    f.window.emit('closed'); vi.runAllTimers(); expect(menu.buildFromTemplate).not.toHaveBeenCalled();
  });
  it('uses native edit permissions and keeps password text out of dictionary lookup', () => {
    const f = fixture(); f.contents.emit('context-menu', {}, { ...params, formControlType: 'input-password', editFlags: { ...params.editFlags, canCut: false, canCopy: false } });
    f.controller.show(f.request.mock.calls[0][0].id);
    const items = (menu.buildFromTemplate.mock.calls as unknown as [MenuItemConstructorOptions[]][])[0][0];
    expect(items.find(i => i.label === '复制')?.enabled).toBe(false);
    expect(items.find(i => i.label === '剪切')?.enabled).toBe(false);
    expect(items.find(i => i.label === '查询')).toBeUndefined();
  });
});
