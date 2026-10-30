import { safeStorage } from 'electron';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { defaultSettings, DocumentSchema, SettingsSchema, type ModelProfile, type Settings, type WritingDocument } from '../../src/models/schema';
import { AppError } from '../llm/errors';

const DraftSchema = z.object({ document: DocumentSchema, path: z.string().nullable(), savedText: z.string(), savedAt: z.string() });
type Draft = z.infer<typeof DraftSchema>;
const BindingSchema = z.object({ endpoint: z.string(), auth: z.enum(['none', 'bearer', 'header']), header: z.string() });
const SecretSchema = BindingSchema.extend({ key: z.string().min(1).max(8000) });
const VaultSchema = z.record(BindingSchema.extend({ ciphertext: z.string().min(1) }));
function matches(binding: z.infer<typeof BindingSchema>, profile: ModelProfile) {
  return binding.endpoint === profile.baseUrl && binding.auth === profile.auth && binding.header === profile.authHeader;
}

export class LocalStore {
  settings: Settings = structuredClone(defaultSettings);
  notice?: string;
  private vault: z.infer<typeof VaultSchema> = {};
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
  private async encryptionAvailable() {
    return await safeStorage.isAsyncEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  }
  async key(profile: ModelProfile): Promise<string | undefined> {
    const saved = this.vault[profile.id];
    if (saved && matches(saved, profile)) {
      try {
        const { result } = await safeStorage.decryptStringAsync(Buffer.from(saved.ciphertext, 'base64'));
        const value = SecretSchema.parse(JSON.parse(result));
        // Check the encrypted binding too; public metadata must never authorize
        // sending a saved key to a different endpoint or authentication header.
        if (matches(value, profile)) return value.key;
      } catch { /* Unavailable Keychain: use only an explicitly configured environment variable. */ }
    }
    return profile.envKey ? process.env[profile.envKey] || undefined : undefined;
  }
  keyStatus() {
    // Bootstrap and settings display must not decrypt or touch the Keychain.
    // This indicates a saved credential, not a successful connection test.
    return Object.fromEntries(this.settings.profiles.map(p => [p.id,
      Boolean((this.vault[p.id] && matches(this.vault[p.id], p)) || (p.envKey && process.env[p.envKey]))]));
  }
  async saveSettings(settings: Settings, keys: Record<string, string | null>) {
    const nextVault = { ...this.vault };
    for (const [id, key] of Object.entries(keys)) {
      const profile = settings.profiles.find(p => p.id === id);
      if (!profile) throw new AppError('settings', '密钥对应的模型配置不存在。');
      if (key === null) { delete nextVault[id]; continue; }
      try {
        if (!await this.encryptionAvailable()) throw new Error('Secure storage unavailable');
        const binding = { endpoint: profile.baseUrl, auth: profile.auth, header: profile.authHeader };
        const ciphertext = (await safeStorage.encryptStringAsync(JSON.stringify({ ...binding, key }))).toString('base64');
        nextVault[id] = { ...binding, ciphertext };
      } catch {
        throw new AppError('keychain', '无法保存密钥：Quillhaya 的系统安全存储不可用。请解锁钥匙串后重试，或使用环境变量。');
      }
    }
    for (const id of Object.keys(nextVault)) if (!settings.profiles.some(p => p.id === id)) delete nextVault[id];
    await this.atomic('credentials.json', nextVault);
    await this.atomic('settings.json', settings);
    this.vault = nextVault;
    this.settings = settings;
  }
}
