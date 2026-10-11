import { safeStorage } from 'electron';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { defaultSettings, DocumentSchema, SettingsSchema, type ModelProfile, type Settings, type WritingDocument } from '../../src/models/schema';
import { AppError } from '../llm/errors';

const DraftSchema = z.object({ document: DocumentSchema, path: z.string().nullable(), savedText: z.string(), savedAt: z.string() });
type Draft = z.infer<typeof DraftSchema>;
const VaultSchema = z.record(z.string());

export class LocalStore {
  settings: Settings = structuredClone(defaultSettings);
  notice?: string;
  private vault: Record<string, string> = {};
  private writes: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.settings = SettingsSchema.parse(JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.notice = '设置文件损坏，已使用默认设置；原文件保留。'; }
    try { this.vault = VaultSchema.parse(JSON.parse(await readFile(join(this.directory, 'credentials.json'), 'utf8'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.notice = '密钥存储无法读取，请在设置中重新添加密钥。'; }
  }
  private atomic(name: string, value: unknown) {
    const task = this.writes.catch(() => {}).then(async () => {
      const temp = join(this.directory, `${name}.tmp`);
      await writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, join(this.directory, name));
    });
    this.writes = task; return task;
  }
  async loadDraft(): Promise<Draft | null> {
    try { return DraftSchema.parse(JSON.parse(await readFile(join(this.directory, 'draft.json'), 'utf8'))); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Preserve damaged bytes before the new blank session can auto-save.
        await copyFile(join(this.directory, 'draft.json'), join(this.directory, `draft.recovery-${Date.now()}.json`));
        this.notice = '草稿无法读取，已在数据目录保留 draft.recovery 备份以便手动恢复。';
      }
      return null;
    }
  }
  saveDraft(document: WritingDocument, path: string | null, savedText: string) {
    return this.atomic('draft.json', { document, path, savedText, savedAt: new Date().toISOString() });
  }
  private encryptionAvailable() {
    return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  }
  key(profile: ModelProfile): string | undefined {
    const encrypted = this.vault[profile.id];
    if (encrypted && this.encryptionAvailable()) {
      try {
        const value = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
        // An existing credential is never silently reused at a changed destination.
        if (value.endpoint === profile.baseUrl && value.auth === profile.auth && value.header === profile.authHeader) return value.key;
      } catch { /* Locked/unavailable Keychain: use explicitly selected environment variable. */ }
    }
    return profile.envKey ? process.env[profile.envKey] || undefined : undefined;
  }
  keyStatus() { return Object.fromEntries(this.settings.profiles.map(p => [p.id, Boolean(this.key(p))])); }
  async saveSettings(settings: Settings, keys: Record<string, string | null>) {
    const nextVault = { ...this.vault };
    for (const [id, key] of Object.entries(keys)) {
      const profile = settings.profiles.find(p => p.id === id);
      if (!profile) throw new AppError('settings', '密钥对应的模型配置不存在。');
      if (key === null) { delete nextVault[id]; continue; }
      if (!this.encryptionAvailable()) throw new AppError('keychain', '系统安全存储不可用，未保存密钥。请解锁 Keychain 或使用环境变量。');
      nextVault[id] = safeStorage.encryptString(JSON.stringify({ endpoint: profile.baseUrl, auth: profile.auth, header: profile.authHeader, key })).toString('base64');
    }
    for (const id of Object.keys(nextVault)) if (!settings.profiles.some(p => p.id === id)) delete nextVault[id];
    await this.atomic('credentials.json', nextVault);
    this.vault = nextVault;
    await this.atomic('settings.json', settings);
    this.settings = settings;
  }
}
