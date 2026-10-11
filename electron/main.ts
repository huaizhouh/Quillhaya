import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme, session, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { DocumentSchema, ProfileSchema, RequestSchema, SettingsSchema, type MenuCommand, type ModelProfile, type Reply } from '../src/models/schema';
import { LocalStore } from './storage/store';
import { Documents } from './storage/documents';
import { CompatibleProvider, MockProvider, type LLMProvider } from './llm/provider';
import { RequestQueue } from './llm/queue';
import { AppError, failure } from './llm/errors';

const here = dirname(fileURLToPath(import.meta.url));
app.setName('TOEFL Writing Assistant');
// Dedicated storage for automated tests; never touches a user's actual drafts.
if (process.env.TWA_TEST_USER_DATA) app.setPath('userData', process.env.TWA_TEST_USER_DATA);
let window: BrowserWindow | null = null;
let allowClose = false;
let quitRequested = false;
const queue = new RequestQueue();
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
  handle('app:bootstrap', async () => {
    const document = await documents.restore();
    return { settings: store.settings, document, restored: document !== null, keyStatus: store.keyStatus(), storageNotice: store.notice };
  });
  handle('settings:save', async data => {
    const { settings, keys } = z.object({ settings: SettingsSchema, keys: z.record(z.string().min(1).max(8000).regex(/^[^\r\n]+$/).nullable()) }).strict().parse(data);
    await store.saveSettings(settings, keys); providers.clear(); queue.clear();
    nativeTheme.themeSource = settings.theme;
    return { settings: store.settings, keyStatus: store.keyStatus() };
  });
  handle('llm:analyze', data => {
    const request = RequestSchema.parse(data);
    const profile = store.settings.profiles.find(p => p.id === request.profile_id);
    if (!profile) throw new AppError('profile', '模型配置不存在，请重新选择。');
    return queue.add(request.request_id, signal => provider(profile).analyze(request, signal));
  });
  handle('llm:cancel', data => { queue.cancel(z.string().uuid().parse(data)); });
  handle('llm:test', data => {
    const { profile, key } = z.object({ profile: ProfileSchema, key: z.string().max(8000).regex(/^[^\r\n]*$/).optional() }).strict().parse(data);
    return queue.add(crypto.randomUUID(), signal => provider(profile, key || undefined).testConnection(signal));
  });
  handle('document:draft', data => documents.draft(DocumentSchema.parse(data)));
  handle('document:open', () => documents.open());
  handle('document:save', data => {
    const { document, saveAs } = z.object({ document: DocumentSchema, saveAs: z.boolean() }).strict().parse(data);
    return documents.save(document, saveAs);
  });
  handle('document:confirm', () => documents.confirmDiscard());
  handle('app:close', async data => {
    await documents.draft(DocumentSchema.parse(data));
    queue.clear(); allowClose = true;
    if (quitRequested) app.quit(); else window?.close();
  });
  handle('app:cancel-close', () => { quitRequested = false; });
  handle('clipboard:copy', async data => { await clipboard.writeText(z.string().max(50_000).parse(data)); });
}

async function createWindow() {
  allowClose = false;
  window = new BrowserWindow({ width: 1380, height: 910, minWidth: 940, minHeight: 650, show: false,
    title: 'TOEFL Writing Assistant', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 23 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1d2423' : '#f7f8f5',
    webPreferences: { preload: join(here, '../preload/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('close', event => { if (!allowClose) { event.preventDefault(); command('close'); } });
  window.on('closed', () => { window = null; queue.clear(); providers.clear(); });
  window.once('ready-to-show', () => window?.show());
  await window.loadURL(trustedUrl);
}

app.whenReady().then(async () => {
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
  if (!allowClose && window) { event.preventDefault(); quitRequested = true; command('close'); }
});
