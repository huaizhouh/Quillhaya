import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FavoriteStore } from '../../electron/storage/favorites';
import { orderedFavorites, type FavoriteInput } from '../../src/models/favorites';
import { good, request } from './fixtures';

const feedback = (text = 'He go home.'): FavoriteInput => ({ scope: 'sentence', result: {
  ...good(request(text)), status: 'needs_revision', suggested_revision: 'He goes home.',
  overall_explanation_zh: '第三人称单数的谓语应使用 goes。', issues: [{ type: 'grammar', severity: 'error', original_span: 'go', suggested_text: 'goes', explanation_zh: '主语是第三人称单数。' }]
} });

describe('saved feedback snapshots', () => {
  let directory: string, store: FavoriteStore;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'quillhaya-favorites-')); store = new FavoriteStore(directory); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  it('keeps the complete snapshot independent of its source and restores it after restart', async () => {
    const input = feedback(), expected = structuredClone(input);
    const saved = await store.add(input);
    input.result.issues[0].explanation_zh = '已改变'; saved.items[0].result.original_text = 'Changed.';
    const loaded = await new FavoriteStore(directory).list();
    expect(loaded.items[0]).toMatchObject(expected); expect(loaded.sort).toBe('newest');
    expect((await stat(join(directory, 'favorites.json'))).mode & 0o777).toBe(0o600);
  });
  it('serializes concurrent changes and deduplicates feedback across session sentence IDs', async () => {
    const first = feedback();
    await Promise.all([store.add(first), store.add({ ...first, result: { ...first.result, sentence_id: 'another-session' } }), store.add(feedback('Second sentence.'))]);
    const loaded = await store.list(); expect(loaded.items).toHaveLength(2);
    expect(orderedFavorites(loaded).map(item => item.result.original_text)).toEqual(['Second sentence.', 'He go home.']);
    await Promise.all(loaded.items.map(item => store.remove(item.id)));
    expect((await new FavoriteStore(directory).list()).items).toEqual([]);
  });
  it('persists manual order, switches back to newest, and retains remaining order after removal', async () => {
    const a = (await store.add(feedback())).items[0];
    const b = (await store.add(feedback('Second sentence.'))).items[0];
    await store.reorder({ sort: 'manual', ids: [a.id, b.id] });
    const restarted = new FavoriteStore(directory); expect((await restarted.list()).items.map(item => item.id)).toEqual([a.id, b.id]);
    expect((await restarted.list()).sort).toBe('manual');
    const latest = await restarted.reorder({ sort: 'newest', ids: [b.id, a.id] }); expect(orderedFavorites(latest)[0].id).toBe(b.id);
    await restarted.remove(b.id); expect((await restarted.list()).items.map(item => item.id)).toEqual([a.id]);
  });
  it('rejects stale or duplicate reorder IDs without dropping stored items', async () => {
    const state = await store.add(feedback()); const id = state.items[0].id;
    for (const ids of [[], [id, id], [crypto.randomUUID()]]) await expect(store.reorder({ sort: 'manual', ids })).rejects.toMatchObject({ code: 'favorites' });
    expect(await store.list()).toEqual(state);
  });
  it('preserves unreadable files and allows retry once the original file is repaired', async () => {
    const path = join(directory, 'favorites.json'); await writeFile(path, '{broken');
    await expect(store.list()).rejects.toMatchObject({ code: 'favorites' });
    await expect(store.add(feedback())).rejects.toMatchObject({ code: 'favorites' });
    expect(await readFile(path, 'utf8')).toBe('{broken');
    await writeFile(path, JSON.stringify({ sort: 'newest', items: [] }));
    expect((await store.add(feedback())).items).toHaveLength(1);
  });
  it('does not report success or change in-memory data on write failure, and recovers on retry', async () => {
    const before = await store.add(feedback());
    await mkdir(join(directory, 'favorites.json.tmp'));
    await expect(store.remove(before.items[0].id)).rejects.toMatchObject({ code: 'favorites' });
    expect(await store.list()).toEqual(before);
    await rm(join(directory, 'favorites.json.tmp'), { recursive: true });
    await store.remove(before.items[0].id); expect((await store.list()).items).toEqual([]);
  });
});
