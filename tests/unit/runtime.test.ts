import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelRuntime } from '../../electron/llm/runtime';
import { RequestQueue } from '../../electron/llm/queue';
import { releaseOllama } from '../../electron/llm/ollama';
import { makeProfile } from '../../src/models/schema';
import { deferred } from './fixtures';

describe('model lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  const profile = makeProfile('ollama');
  it('tests only its target, isolates other work and releases the model after success', async () => {
    const queue = new RequestQueue(2, 0), runtime = new ModelRuntime(queue);
    const response = deferred<string>(), release = vi.fn(async () => {}), run = vi.fn(() => response.promise);
    const testing = runtime.test('test', profile, run, release);
    expect(() => runtime.assertAvailable()).toThrow('正在测试或释放');
    await Promise.resolve(); expect(run).toHaveBeenCalledOnce(); expect(release).not.toHaveBeenCalled();
    response.resolve('连接成功'); await expect(testing).resolves.toContain('已从 Ollama 内存中释放');
    expect(release).toHaveBeenCalledOnce(); expect(() => runtime.assertAvailable()).not.toThrow();
    await runtime.stop(); expect(release).toHaveBeenCalledOnce();
  });
  it('releases a cancelled test and never runs cancelled pending reviews', async () => {
    const queue = new RequestQueue(1, 0), runtime = new ModelRuntime(queue), release = vi.fn(async () => {});
    const pendingReview = vi.fn(async () => 'review');
    const review = queue.add('review', pendingReview); const cancelledReview = expect(review).rejects.toMatchObject({ name: 'AbortError' });
    const testing = runtime.test('test', profile, signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))), release);
    const cancelledTest = expect(testing).rejects.toMatchObject({ code: 'cancelled', message: expect.stringContaining('已从 Ollama 内存中释放') });
    await cancelledReview; await new Promise(resolve => setTimeout(resolve, 0)); queue.cancel('test');
    await cancelledTest; expect(release).toHaveBeenCalledOnce(); expect(pendingReview).not.toHaveBeenCalled();
  });
  it('releases failed tests and keeps failed cleanup available for an explicit retry', async () => {
    const queue = new RequestQueue(1, 0), runtime = new ModelRuntime(queue);
    const release = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    await expect(runtime.test('test', profile, async () => { throw new Error('test failed'); }, release)).rejects.toMatchObject({ code: 'release_failed' });
    await expect(runtime.stop()).resolves.toMatchObject({ released: [profile.model], failed: [] }); expect(release).toHaveBeenCalledTimes(2);
  });
  it('cancels active work and waits for it to settle before unloading; stop is idempotent', async () => {
    const queue = new RequestQueue(2, 0), runtime = new ModelRuntime(queue), settled = deferred<string>();
    let signal!: AbortSignal; const release = vi.fn(async () => {});
    runtime.track(profile, release);
    const running = queue.add('running', s => { signal = s; return settled.promise; }); await Promise.resolve();
    const stop = runtime.stop(); expect(runtime.stop()).toBe(stop); expect(() => runtime.assertAvailable()).toThrow();
    await Promise.resolve(); expect(signal.aborted).toBe(true); expect(release).not.toHaveBeenCalled();
    settled.resolve('finished'); await running;
    await expect(stop).resolves.toEqual({ released: [profile.model], alreadyReleased: [], failed: [] }); expect(release).toHaveBeenCalledOnce();
  });
  it('unloads only tracked models and reports failures without claiming success', async () => {
    const runtime = new ModelRuntime(new RequestQueue(2, 0)), release = vi.fn(async () => {});
    runtime.track(profile, release); runtime.track({ ...profile, model: 'failed' }, async () => { throw new Error('offline'); });
    const result = await runtime.stop(); expect(result.released).toEqual([profile.model]); expect(result.failed).toHaveLength(1); expect(result.failed[0].model).toBe('failed');
  });
  it('retires absent historical model IDs and still releases the renamed current model', async () => {
    const runtime = new ModelRuntime(new RequestQueue(2, 0));
    const old = vi.fn(async () => 'not_resident' as const), current = vi.fn(async () => 'released' as const);
    runtime.track({ ...profile, model: 'old-model' }, old); runtime.track({ ...profile, model: 'new-model' }, current);
    await expect(runtime.stop()).resolves.toEqual({ released: ['new-model'], alreadyReleased: ['old-model'], failed: [] });
    await runtime.stop(); expect(old).toHaveBeenCalledOnce(); expect(current).toHaveBeenCalledOnce();
  });
});

describe('Ollama unload protocol', () => {
  afterEach(() => vi.useRealTimers());
  it('preserves a proxy path and authentication, sends only model/keep_alive/stream', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ done: true, done_reason: 'unload' })));
    await releaseOllama({ ...makeProfile('ollama'), baseUrl: 'http://localhost:11434/ollama/v1/', auth: 'bearer' }, 'synthetic-key', fetcher);
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/ollama/api/generate'); expect(options.redirect).toBe('error');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer synthetic-key' });
    expect(JSON.parse(options.body as string)).toEqual({ model: 'llama3.2', keep_alive: 0, stream: false });
  });
  it.each([new Response('private server error', { status: 500 }), new Response(JSON.stringify({ done: true, done_reason: 'stop' }))])('requires explicit server confirmation and hides raw errors', async response => {
    await expect(releaseOllama(makeProfile('ollama'), undefined, vi.fn(async () => response))).rejects.toMatchObject({ code: 'release_failed' });
  });
  it('times out cleanup independently of an already cancelled inference', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const assertion = expect(releaseOllama(makeProfile('ollama'), undefined, fetcher)).rejects.toThrow('释放模型超时');
    await vi.advanceTimersByTimeAsync(10_000); await assertion;
  });
  it('confirms a missing historical model through /api/ps with the same auth and proxy path', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'gemma4:12b-mlx' }] })));
    const p = { ...makeProfile('ollama'), model: 'gemma4:12b', baseUrl: 'http://localhost:11434/proxy/v1', auth: 'bearer' as const };
    await expect(releaseOllama(p, 'synthetic-key', fetcher)).resolves.toBe('not_resident');
    expect(fetcher.mock.calls[1][0]).toBe('http://localhost:11434/proxy/api/ps');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer synthetic-key' } });
    expect(fetcher.mock.calls[1][1].signal).toBe(fetcher.mock.calls[0][1].signal);
  });
  it.each([
    { models: [{ name: 'llama3.2:latest' }] },
    { models: [{ model: 'llama3.2' }] },
    { models: [{}] },
    { models: null },
    { status: 'ok' }
  ])('does not hide 404 when the model is resident or the status is invalid: %j', async body => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(releaseOllama(makeProfile('ollama'), undefined, fetcher)).rejects.toMatchObject({ code: 'release_failed' });
  });
  it('does not turn an unavailable status endpoint into successful release', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 404 })).mockResolvedValueOnce(new Response('{}', { status: 404 }));
    await expect(releaseOllama(makeProfile('ollama'), undefined, fetcher)).rejects.toMatchObject({ code: 'release_failed' });
  });
});
