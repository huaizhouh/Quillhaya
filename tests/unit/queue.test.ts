import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestQueue } from '../../electron/llm/queue';
import { deferred } from './fixtures';
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
});
