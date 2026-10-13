import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings, makeProfile, type WritingDocument } from '../../src/models/schema';

const electron = vi.hoisted(() => ({
  safeStorage: { isEncryptionAvailable: vi.fn(() => true), getSelectedStorageBackend: vi.fn(() => 'keychain'), encryptString: vi.fn((text: string) => Buffer.from(Buffer.from(text).map(b => b ^ 42))), decryptString: vi.fn((value: Buffer) => Buffer.from(Buffer.from(value).map(b => b ^ 42)).toString('utf8')) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() }
}));
vi.mock('electron', () => electron);
import { LocalStore } from '../../electron/storage/store';
import { Documents } from '../../electron/storage/documents';

describe('document and settings persistence', () => {
  let directory: string;
  let store: LocalStore;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'twa-unit-')); store = new LocalStore(directory); await store.init(); electron.safeStorage.isEncryptionAvailable.mockReturnValue(true); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('encrypts credentials, returns only key presence, and binds a key to the destination', async () => {
    const profile = makeProfile('custom', 'custom'); const settings = { ...defaultSettings, profiles: [profile], defaultProfileId: profile.id };
    await store.saveSettings(settings, { custom: 'synthetic-unit-test-credential' });
    expect(await readFile(join(directory, 'credentials.json'), 'utf8')).not.toContain('synthetic-unit-test-credential');
    expect(await readFile(join(directory, 'settings.json'), 'utf8')).not.toContain('synthetic-unit-test-credential');
    expect(store.keyStatus()).toEqual({ custom: true });
    expect(store.key(profile)).toBe('synthetic-unit-test-credential');
    expect(store.key({ ...profile, baseUrl: 'https://other.example/v1' })).toBeUndefined();
    const restarted = new LocalStore(directory); await restarted.init(); expect(restarted.key(profile)).toBe('synthetic-unit-test-credential');
    await restarted.saveSettings(settings, { custom: null }); expect(restarted.keyStatus()).toEqual({ custom: false });
  });
  it('never falls back to plaintext when secure storage is unavailable', async () => {
    electron.safeStorage.isEncryptionAvailable.mockReturnValue(false);
    await expect(store.saveSettings(defaultSettings, { mock: 'synthetic-key' })).rejects.toMatchObject({ code: 'keychain' });
    await expect(readFile(join(directory, 'credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('serializes drafts atomically and restores the latest one without changing source files', async () => {
    const doc: WritingDocument = { id: crypto.randomUUID(), name: 'draft.md', text: 'First.', task: 'Task', mode: 'email', dirty: true };
    const path = join(directory, 'source.md'); await writeFile(path, 'Original.');
    await Promise.all([store.saveDraft(doc, path, 'Original.'), store.saveDraft({ ...doc, text: 'Latest.' }, path, 'Original.')]);
    expect((await store.loadDraft())?.document.text).toBe('Latest.'); expect(await readFile(path, 'utf8')).toBe('Original.');
  });
  it('preserves UTF-8, BOM and Windows line endings through editing and saving', async () => {
    const path = join(directory, 'essay.md'); await writeFile(path, '\uFEFFHello world.\r\n中文说明。\r\n');
    electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] });
    const documents = new Documents(store, () => ({} as Electron.BrowserWindow)); const opened = (await documents.open())!;
    expect(opened.text).toBe('Hello world.\n中文说明。\n');
    await documents.save({ ...opened, text: opened.text + 'More words.\n', dirty: true }, false);
    expect(await readFile(path, 'utf8')).toBe('\uFEFFHello world.\r\n中文说明。\r\nMore words.\r\n');
  });
  it('does not overwrite external changes after cancellation', async () => {
    const path = join(directory, 'essay.md'); await writeFile(path, 'Original.');
    electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] });
    const documents = new Documents(store, () => ({} as Electron.BrowserWindow)); const opened = (await documents.open())!;
    await writeFile(path, 'External edit.'); electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await documents.save({ ...opened, text: 'My edit.' }, false)).toBeNull(); expect(await readFile(path, 'utf8')).toBe('External edit.');
  });
  it('rejects invalid UTF-8 instead of replacing bytes silently', async () => {
    const path = join(directory, 'broken.md'); await writeFile(path, Buffer.from([0xff, 0xfe]));
    electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] });
    await expect(new Documents(store, () => ({} as Electron.BrowserWindow)).open()).rejects.toMatchObject({ code: 'encoding' });
  });
  it('keeps a recovery copy of a damaged draft before a new session can overwrite it', async () => {
    await writeFile(join(directory, 'draft.json'), '{damaged but valuable');
    expect(await store.loadDraft()).toBeNull();
    const recovery = (await readdir(directory)).find(name => name.startsWith('draft.recovery-'))!;
    expect(await readFile(join(directory, recovery), 'utf8')).toBe('{damaged but valuable');
  });
  it('loads older settings with a separate default revision wait without changing their saved debounce', async () => {
    const { revisionDebounceMs: _unused, ...legacy } = defaultSettings;
    await writeFile(join(directory, 'settings.json'), JSON.stringify({ ...legacy, debounceMs: 1900 }));
    const restarted = new LocalStore(directory); await restarted.init();
    expect(restarted.settings.debounceMs).toBe(1900); expect(restarted.settings.revisionDebounceMs).toBe(3000); expect(restarted.notice).toBeUndefined();
  });
  it('derives saved-to-file status from the actual file association, including legacy drafts', async () => {
    const doc: WritingDocument = { id: crypto.randomUUID(), name: '未命名.md', text: '', task: '', mode: 'email', dirty: false };
    const documents = new Documents(store, () => ({} as Electron.BrowserWindow));
    await store.saveDraft(doc, null, ''); expect((await documents.restore())?.hasFile).toBe(false);
    const path = join(directory, '未命名.md'); await writeFile(path, '');
    await store.saveDraft(doc, path, ''); expect((await documents.restore())?.hasFile).toBe(true);
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await documents.save({ ...doc, id: crypto.randomUUID() }, false)).toBeNull();
  });
});
