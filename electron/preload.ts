import { contextBridge, ipcRenderer } from 'electron';
import type { AnalysisProgress, ContextMenuRequest, DesktopAPI, MenuCommand } from '../src/models/schema';

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveSettings: (settings, keys) => ipcRenderer.invoke('settings:save', { settings, keys }),
  testConnection: (profile, key, requestId) => ipcRenderer.invoke('llm:test', { profile, key, requestId }),
  showConnectionDetails: id => ipcRenderer.invoke('llm:test-details', id),
  stopModels: (profile, key) => ipcRenderer.invoke('llm:stop', { profile, key }),
  analyze: request => ipcRenderer.invoke('llm:analyze', request),
  cancel: requestId => ipcRenderer.invoke('llm:cancel', requestId),
  draft: document => ipcRenderer.invoke('document:draft', document),
  open: () => ipcRenderer.invoke('document:open'),
  checkFile: id => ipcRenderer.invoke('document:check', id),
  save: (document, saveAs) => ipcRenderer.invoke('document:save', { document, saveAs }),
  confirmDiscard: () => ipcRenderer.invoke('document:confirm'),
  close: document => ipcRenderer.invoke('app:close', document),
  cancelClose: () => ipcRenderer.invoke('app:cancel-close'),
  rendererFailed: document => ipcRenderer.invoke('app:renderer-failed', document),
  copy: text => ipcRenderer.invoke('clipboard:copy', text),
  showContextMenu: (id, sentenceId) => ipcRenderer.invoke('context-menu:show', { id, sentenceId }),
  onContextMenu: callback => {
    const handler = (_event: Electron.IpcRendererEvent, request: ContextMenuRequest) => callback(request);
    ipcRenderer.on('context-menu:request', handler);
    return () => ipcRenderer.removeListener('context-menu:request', handler);
  },
  onLocateFeedback: callback => {
    const handler = (_event: Electron.IpcRendererEvent, sentenceId: string) => callback(sentenceId);
    ipcRenderer.on('context-menu:locate-feedback', handler);
    return () => ipcRenderer.removeListener('context-menu:locate-feedback', handler);
  },
  onAnalysisProgress: callback => {
    const handler = (_event: Electron.IpcRendererEvent, progress: AnalysisProgress) => callback(progress);
    ipcRenderer.on('llm:progress', handler);
    return () => ipcRenderer.removeListener('llm:progress', handler);
  },
  onMenu: callback => {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand) => callback(command);
    ipcRenderer.on('menu:command', handler);
    return () => ipcRenderer.removeListener('menu:command', handler);
  }
};
contextBridge.exposeInMainWorld('desktop', api);
