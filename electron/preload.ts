import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, MenuCommand } from '../src/models/schema';

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveSettings: (settings, keys) => ipcRenderer.invoke('settings:save', { settings, keys }),
  testConnection: (profile, key) => ipcRenderer.invoke('llm:test', { profile, key }),
  analyze: request => ipcRenderer.invoke('llm:analyze', request),
  cancel: requestId => ipcRenderer.invoke('llm:cancel', requestId),
  draft: document => ipcRenderer.invoke('document:draft', document),
  open: () => ipcRenderer.invoke('document:open'),
  save: (document, saveAs) => ipcRenderer.invoke('document:save', { document, saveAs }),
  confirmDiscard: () => ipcRenderer.invoke('document:confirm'),
  close: document => ipcRenderer.invoke('app:close', document),
  cancelClose: () => ipcRenderer.invoke('app:cancel-close'),
  copy: text => ipcRenderer.invoke('clipboard:copy', text),
  onMenu: callback => {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand) => callback(command);
    ipcRenderer.on('menu:command', handler);
    return () => ipcRenderer.removeListener('menu:command', handler);
  }
};
contextBridge.exposeInMainWorld('desktop', api);
