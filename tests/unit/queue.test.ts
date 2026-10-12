import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestQueue, serialKey } from '../../electron/llm/queue';
import { CompatibleProvider } from '../../electron/llm/provider';
import { makeProfile } from '../../src/models/schema';
import { deferred, good, request, testProfile } from './fixtures';
describe('main-process queue', () => {
  afterEach(() => vi.useRealTimers());
  it('never exceeds two simultaneous requests and spaces starts', async () => {
    vi.useFakeTimers(); const queue = new RequestQueue(2, 300); const a = deferred<string>(), b = deferred<string>(), c = deferred<string>();
    const runA = vi.fn(() => a.promise), runB = vi.fn(() => b.promise), runC = vi.fn(() => c.promise);
    const pa = queue.add('a', runA), pb = queue.add('b', runB), pc = queue.add('c', runC);
    await vi.advanceTimersByTimeAsync(0); expect(runA).toHaveBeenCalledOnce(); expect(runB).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300); expect(runB).toHaveBeenCalledOnce(); expect(runC).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); expect(runC).not.toHaveBeenCalled(); a.resolve('a'); await vi.advanceTimersByTimeAsync(0); expect(runC).toHaveBeenCalledOnce();
    b.resolve('b'); c.resolve('c'); await expect(Promise.all([pa, pb, pc])).resolves.toEqual(['a', 'b', 'c']); queue.clear();
  });
  it('cancels queued and running work', async () => {
    vi.useFakeTimers(); const queue = new RequestQueue(1, 0);
    const first = queue.add('first', signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const second = queue.add('second', async () => 'second');
    const a = expect(first).rejects.toMatchObject({ name: 'AbortError' }), b = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0); queue.cancel('first'); queue.cancel('second'); await Promise.all([a, b]);
  });
  it('serializes the same Ollama server across models, without blocking other servers', async () => {
    vi.useFakeTimers(); const queue = new RequestQueue(2, 0); const first = deferred<string>();
    const key = serialKey(makeProfile('ollama'));
    expect(serialKey({ ...makeProfile('ollama'), baseUrl: 'http://localhost:11434/v1/', model: 'another' })).toBe(key);
    const second = vi.fn(async () => 'second'), cloud = vi.fn(async () => 'cloud');
    const a = queue.add('a', () => first.promise, key), b = queue.add('b', second, key), c = queue.add('c', cloud);
    await vi.advanceTimersByTimeAsync(2000); expect(second).not.toHaveBeenCalled(); expect(cloud).toHaveBeenCalledOnce();
    first.resolve('first'); await vi.advanceTimersByTimeAsync(0);
    await expect(Promise.all([a, b, c])).resolves.toEqual(['first', 'second', 'cloud']); queue.clear();
  });
  it('does not start a provider timeout while a request waits longer than that timeout', async () => {
    vi.useFakeTimers(); const queue = new RequestQueue(2, 0); const first = deferred<string>(); const r = request();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good(r)) } }] })));
    const provider = new CompatibleProvider({ ...testProfile, timeoutMs: 1000 }, undefined, fetcher);
    const a = queue.add('a', () => first.promise, 'ollama'), b = queue.add('b', signal => provider.analyze(r, signal), 'ollama');
    await vi.advanceTimersByTimeAsync(10_000); expect(fetcher).not.toHaveBeenCalled();
    first.resolve('first'); await vi.advanceTimersByTimeAsync(0);
    await expect(b).resolves.toMatchObject({ status: 'good' }); await a; queue.clear();
  });
  it('never starts a queued request that was cancelled before its run microtask', async () => {
    const queue = new RequestQueue(1, 0), run = vi.fn(async () => 'done');
    const pending = queue.add('cancelled', run); queue.cancel('cancelled');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(run).not.toHaveBeenCalled(); queue.clear();
  });
});
