import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, session, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DocumentSchema, ProfileSchema, RequestSchema, SettingsSchema, type MenuCommand, type ModelProfile, type Reply } from '../src/models/schema';
import { LocalStore } from './storage/store';
import { Documents } from './storage/documents';
import { CompatibleProvider, MockProvider, type LLMProvider } from './llm/provider';
import { RequestQueue, serialKey } from './llm/queue';
import { ModelRuntime } from './llm/runtime';
import { AppError, failure } from './llm/errors';
import { ConnectionDiagnostics, diagnosticHTML, type ConnectionReport } from './llm/connection-diagnostics';
import { installContextMenu } from './context-menu';

const here = dirname(fileURLToPath(import.meta.url));
// Keep the pre-ready name: Electron 44 uses it to initialize the macOS
// Keychain service. Rename the visible app after ready so existing keys decrypt.
// The data directory also stays stable; tests always use an isolated override.
app.setName('TOEFL Writing Assistant');
app.setPath('userData', process.env.TWA_TEST_USER_DATA || join(app.getPath('appData'), 'TOEFL Writing Assistant'));
let window: BrowserWindow | null = null;
let detailsWindow: BrowserWindow | null = null;
let contextMenu: ReturnType<typeof installContextMenu> | undefined;
let connectionReport: ConnectionReport | undefined;
let allowClose = false;
let quitRequested = false;
let rendererFailed = false;
let recoveryWrite: Promise<void> = Promise.resolve();
let recoveryClosePending = false;
let closing: Promise<void> | undefined;
const queue = new RequestQueue();
const runtime = new ModelRuntime(queue);
let store: LocalStore;
let documents: Documents;
const providers = new Map<string, LLMProvider>();
const rendererPath = join(here, '../renderer/index.html');
const devUrl = process.env.ELECTRON_RENDERER_URL;
// Vite may provide an origin without a trailing slash; Chromium canonicalizes it.
const trustedUrl = new URL(devUrl || pathToFileURL(rendererPath).href).href;

function trusted(event: IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== trustedUrl)
    throw new AppError('ipc', '已阻止不可信来源。');
}
function handle<T>(channel: string, action: (data: unknown) => Promise<T> | T) {
  ipcMain.handle(channel, async (event, data): Promise<Reply<T>> => {
    try { trusted(event); return { ok: true, value: await action(data) }; }
    catch (error) { return { ok: false, error: error instanceof z.ZodError ? { code: 'validation', message: '输入参数无效，请检查文本长度、地址和设置。', retryable: false } : failure(error) }; }
  });
}
function provider(profile: ModelProfile, transientKey?: string): LLMProvider {
  if (profile.kind === 'mock') return new MockProvider(profile.mockBehavior);
  if (transientKey !== undefined) return new CompatibleProvider(profile, transientKey);
  const cacheKey = JSON.stringify(profile);
  let p = providers.get(cacheKey);
  if (!p) { p = new CompatibleProvider(profile, store.key(profile)); providers.set(cacheKey, p); }
  return p;
}
function command(value: MenuCommand) { window?.webContents.send('menu:command', value); }
function finishClose(): Promise<void> {
  if (closing) return closing;
  closing = Promise.resolve().then(async () => {
    // Keep the main process alive until cancellation and native unloading finish.
    for (;;) {
      const result = await runtime.stop();
      if (!result.failed.length) break;
      const options = { type: 'warning' as const, message: '部分模型未能释放', detail: result.failed.map(item => `${item.model}：${item.message}`).join('\n'), buttons: ['重试释放', '仍然关闭', '返回写作'], defaultId: 0, cancelId: 2 };
      const reply = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      if (reply.response === 1) break;
      if (reply.response !== 0) { quitRequested = false; return; }
    }
    allowClose = true;
    if (quitRequested) app.quit(); else window?.close();
  }).finally(() => { closing = undefined; });
  return closing;
}
function requestClose() {
  if (closing) return;
  if (!rendererFailed) { command('close'); return; }
  if (recoveryClosePending) return;
  recoveryClosePending = true;
  // A failed React tree no longer has its menu listener. Preserve its last snapshot
  // before exiting, without waiting for that missing renderer acknowledgement.
  void recoveryWrite.catch(async () => {
    if (!window) return;
    const reply = await dialog.showMessageBox(window, { type: 'warning', message: '最新草稿未能保存', detail: '请先从恢复页面复制正文。现在退出可能丢失最近的修改。', buttons: ['返回复制正文', '仍然退出'], defaultId: 0, cancelId: 0 });
    if (reply.response !== 1) { quitRequested = false; return false; }
  }).then(proceed => { if (proceed !== false) return finishClose(); }).catch(() => { quitRequested = false; }).finally(() => { recoveryClosePending = false; });
}
function createMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [
      { role: 'about' as const }, { type: 'separator' as const },
      { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => command('settings') },
      { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const },
      { type: 'separator' as const }, { role: 'quit' as const }
    ] }] : []),
    { label: '文件', submenu: [
      { label: '新建', accelerator: 'CmdOrCtrl+N', click: () => command('new') },
      { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => command('open') },
      { type: 'separator' }, { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
      { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: () => command('saveAs') },
      { type: 'separator' }, { role: 'close' }
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIPC() {
  handle('context-menu:show', data => {
    const { id, sentenceId } = z.object({ id: z.string().uuid(), sentenceId: z.string().min(1).max(100).optional() }).strict().parse(data);
    contextMenu?.show(id, sentenceId);
  });
  handle('app:bootstrap', async () => {
    rendererFailed = false;
    const document = await documents.restore();
    return { settings: store.settings, document, restored: document !== null, keyStatus: store.keyStatus(), storageNotice: store.notice };
  });
  handle('settings:save', async data => {
    const { settings, keys } = z.object({ settings: SettingsSchema, keys: z.record(z.string().min(1).max(8000).regex(/^[^\r\n]+$/).nullable()) }).strict().parse(data);
    const { name: _previousName, ...previous } = store.settings.profiles.find(p => p.id === store.settings.defaultProfileId)!;
    const { name: _currentName, ...current } = settings.profiles.find(p => p.id === settings.defaultProfileId)!;
    // Schema parsing may reorder object keys; display names and property order
    // must not cancel inference or invalidate otherwise unchanged feedback.
    const analysisChanged = !isDeepStrictEqual(previous, current) || Object.hasOwn(keys, current.id);
    await store.saveSettings(settings, keys);
    if (analysisChanged) { providers.clear(); queue.clear(); }
    nativeTheme.themeSource = settings.theme;
    return { settings: store.settings, keyStatus: store.keyStatus(), analysisChanged };
  });
  handle('llm:analyze', data => {
    if (closing) throw new AppError('closing', '正在关闭应用并释放模型。');
    runtime.assertAvailable();
    const request = RequestSchema.parse(data);
    const profile = store.settings.profiles.find(p => p.id === request.profile_id);
    if (!profile) throw new AppError('profile', '模型配置不存在，请重新选择。');
    window?.webContents.send('llm:progress', { requestId: request.request_id, phase: 'queued' });
    return queue.add(request.request_id, signal => {
      window?.webContents.send('llm:progress', { requestId: request.request_id, phase: 'running' });
      const p = provider(profile);
      runtime.track(profile, profile.kind === 'ollama' ? () => p.release!() : undefined);
      return p.analyze(request, signal);
    }, serialKey(profile));
  });
  handle('llm:cancel', data => { queue.cancel(z.string().uuid().parse(data)); });
  handle('llm:test', async data => {
    if (closing) throw new AppError('closing', '正在关闭应用并释放模型。');
    const { profile, key, requestId } = z.object({ profile: ProfileSchema, key: z.string().max(8000).regex(/^[^\r\n]*$/).optional(), requestId: z.string().uuid().optional() }).strict().parse(data);
    connectionReport = undefined;
    const resolvedKey = key || store.key(profile);
    const diagnostics = new ConnectionDiagnostics(profile, resolvedKey);
    const p: LLMProvider = profile.kind === 'mock' ? new MockProvider(profile.mockBehavior) : new CompatibleProvider(profile, resolvedKey, diagnostics.fetcher());
    try { return await runtime.test(requestId ?? crypto.randomUUID(), profile, signal => p.testConnection(signal), profile.kind === 'ollama' ? () => p.release!() : undefined); }
    catch (error) {
      const problem = failure(error);
      connectionReport = diagnostics.finish(problem);
      throw new AppError(problem.code, problem.message, problem.retryable, connectionReport.id);
    }
  });
  handle('llm:test-details', async data => {
    const id = z.string().uuid().parse(data);
    if (!connectionReport || connectionReport.id !== id) throw new AppError('details_expired', '测试详情已过期，请重新测试连接。');
    detailsWindow?.destroy();
    const detail = new BrowserWindow({ width: 1000, height: 760, minWidth: 640, minHeight: 450, parent: window!, title: '连接测试详情', show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    detailsWindow = detail;
    installContextMenu(detail);
    detail.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    detail.webContents.on('will-navigate', event => event.preventDefault());
    detail.on('closed', () => { if (detailsWindow === detail) detailsWindow = null; });
    await detail.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(diagnosticHTML(connectionReport))}`);
    detail.show();
  });
  handle('llm:stop', data => {
    const input = z.object({ profile: ProfileSchema.optional(), key: z.string().max(8000).regex(/^[^\r\n]*$/).optional() }).strict().parse(data);
    const profile = input.profile ?? store.settings.profiles.find(p => p.id === store.settings.defaultProfileId)!;
    if (profile.kind === 'ollama') { const p = provider(profile, input.key || undefined); runtime.track(profile, () => p.release!()); }
    return runtime.stop();
  });
  handle('document:draft', data => documents.draft(DocumentSchema.parse(data)));
  handle('document:open', () => documents.open());
  handle('document:check', data => documents.checkFile(z.string().uuid().parse(data)));
  handle('document:save', data => {
    const { document, saveAs } = z.object({ document: DocumentSchema, saveAs: z.boolean() }).strict().parse(data);
    return documents.save(document, saveAs);
  });
  handle('document:confirm', () => documents.confirmDiscard());
  handle('app:close', async data => {
    await documents.draft(DocumentSchema.parse(data));
    await finishClose();
  });
  handle('app:cancel-close', () => { quitRequested = false; });
  handle('app:renderer-failed', data => {
    const snapshot = DocumentSchema.optional().parse(data);
    rendererFailed = true; queue.clear();
    recoveryWrite = snapshot ? documents.draft(snapshot) : Promise.resolve();
    return recoveryWrite;
  });
  handle('clipboard:copy', async data => { await clipboard.writeText(z.string().max(50_000).parse(data)); });
}

async function createWindow() {
  allowClose = false;
  rendererFailed = false;
  recoveryWrite = Promise.resolve();
  window = new BrowserWindow({ width: 1380, height: 910, minWidth: 940, minHeight: 650, show: false,
    title: 'Quillhaya - Writing Assistant', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 23 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d2423' : '#f7f8f5',
    webPreferences: { preload: join(here, '../preload/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const owner = window;
  contextMenu = installContextMenu(owner, request => owner.webContents.send('context-menu:request', request));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => { rendererFailed = true; queue.clear(); });
  window.on('close', event => { if (!allowClose) { event.preventDefault(); requestClose(); } });
  window.on('closed', () => { detailsWindow?.destroy(); connectionReport = undefined; contextMenu = undefined; window = null; queue.clear(); providers.clear(); });
  window.once('ready-to-show', () => window?.show());
  await window.loadURL(trustedUrl);
}

app.whenReady().then(async () => {
  app.setName('Quillhaya');
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(join(here, '../../icon/generated/app-icon.png'));
  store = new LocalStore(app.getPath('userData')); await store.init();
  nativeTheme.themeSource = store.settings.theme;
  documents = new Documents(store, () => window!);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIPC(); createMenu(); await createWindow();
  app.on('activate', () => { if (!window) void createWindow(); });
}).catch(() => { process.stderr.write('应用启动失败，请检查数据目录权限或重新安装依赖。\n'); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (!allowClose && window) { event.preventDefault(); quitRequested = true; requestClose(); }
  else if (!allowClose) { event.preventDefault(); quitRequested = true; void finishClose(); }
});
