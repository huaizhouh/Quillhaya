import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { FavoriteInputSchema, FavoriteLibrarySchema, FavoriteOrderSchema, favoriteKey, type FavoriteInput, type FavoriteLibrary, type FavoriteOrder } from '../../src/models/favorites';
import { AppError } from '../llm/errors';

export class FavoriteStore {
  private state?: FavoriteLibrary;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  private async load() {
    if (this.state) return this.state;
    try { this.state = FavoriteLibrarySchema.parse(JSON.parse(await readFile(join(this.directory, 'favorites.json'), 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError('favorites', '收藏夹无法读取，原文件已保留。请检查文件或目录权限后重试。');
      this.state = { sort: 'newest', items: [] };
    }
    return this.state;
  }
  async list() { await this.flush(); return structuredClone(await this.load()); }
  async flush() { await this.writes.catch(() => {}); }
  private change(update: (current: FavoriteLibrary) => FavoriteLibrary) {
    const task = this.writes.catch(() => {}).then(async () => {
      const next = update(structuredClone(await this.load()));
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const path = join(this.directory, 'favorites.json');
        await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
        await rename(`${path}.tmp`, path);
      } catch { throw new AppError('favorites', '收藏夹保存失败，请检查目录权限或磁盘空间后重试。'); }
      this.state = next;
      return structuredClone(next);
    });
    this.writes = task;
    return task;
  }
  add(input: FavoriteInput) {
    const snapshot = FavoriteInputSchema.parse(input);
    return this.change(current => {
      if (!current.items.some(item => favoriteKey(item) === favoriteKey(snapshot)))
        current.items.unshift({ ...snapshot, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
      return current;
    });
  }
  remove(id: string) { return this.change(current => ({ ...current, items: current.items.filter(item => item.id !== id) })); }
  reorder(input: FavoriteOrder) {
    const order = FavoriteOrderSchema.parse(input);
    return this.change(current => {
      const items = new Map(current.items.map(item => [item.id, item]));
      if (order.ids.length !== items.size || new Set(order.ids).size !== items.size || order.ids.some(id => !items.has(id)))
        throw new AppError('favorites', '收藏列表已变化，请重新打开收藏夹后调整顺序。');
      return { sort: order.sort, items: order.ids.map(id => items.get(id)!) };
    });
  }
}
