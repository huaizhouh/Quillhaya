import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisCoordinator, type AnalysisContext, type FeedbackEntry } from '../../src/core/coordinator';
import type { AnalysisRequest, AnalysisResult, Reply } from '../../src/models/schema';
import { deferred, good } from './fixtures';

describe('non-blocking coordinator', () => {
  let context: AnalysisContext;
  beforeEach(() => { vi.useFakeTimers(); context = { documentId: crypto.randomUUID(), revision: 1, mode: 'general', task: '', profileId: 'mock', configVersion: 0 }; });
  afterEach(() => vi.useRealTimers());
  function setup() {
    const requests: { r: AnalysisRequest; d: ReturnType<typeof deferred<Reply<AnalysisResult>>> }[] = [];
    const api = { analyze: vi.fn((r: AnalysisRequest) => { const d = deferred<Reply<AnalysisResult>>(); requests.push({ r, d }); return d.promise; }), cancel: vi.fn(async () => {}) };
    let entries: FeedbackEntry[] = [];
    const engine = new AnalysisCoordinator(api, next => { entries = next; });
    return { engine, api, requests, get entries() { return entries; } };
  }
  it('merges quick input and never repeats an unchanged sentence', async () => {
    const t = setup();
    for (const text of ['I', 'I like', 'I like books.']) { t.engine.update(text, context); await vi.advanceTimersByTimeAsync(60); }
    expect(t.api.analyze).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(220);
    expect(t.api.analyze).toHaveBeenCalledTimes(1);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update('I like books. ', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(2000);
    expect(t.api.analyze).toHaveBeenCalledTimes(1); expect(t.entries[0].state).toBe('done'); t.engine.dispose();
  });
  it('drops stale results when a sentence changes', async () => {
    const t = setup(); t.engine.update('He go home.', context); await vi.advanceTimersByTimeAsync(220);
    t.engine.update('He goes home.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0].text).toBe('He goes home.'); expect(t.entries[0].result).toBeUndefined(); expect(t.api.cancel).toHaveBeenCalled();
    t.requests[1].d.resolve({ ok: true, value: good(t.requests[1].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0].result?.original_text).toBe('He goes home.'); t.engine.dispose();
  });
  it('keeps completed feedback when later sentences are appended or edited', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    const firstId = t.entries[0].id;
    t.engine.update('We learn. Practice helps.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(1500);
    expect(t.requests.map(({ r }) => r.original_text)).toEqual(['We learn.', 'Practice helps.']);
    expect(t.entries[0]).toMatchObject({ id: firstId, state: 'done' });
    t.engine.update('We learn. Practice helps us.', { ...context, revision: 3 }); await vi.advanceTimersByTimeAsync(1500);
    expect(t.entries[0]).toMatchObject({ id: firstId, state: 'done' });
    expect(t.api.cancel).not.toHaveBeenCalledWith(t.requests[0].r.request_id); t.engine.dispose();
  });
  it('preserves an in-flight earlier review and distinguishes queueing from inference', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    expect(t.entries[0].state).toBe('queued');
    t.engine.progress({ requestId: t.requests[0].r.request_id, phase: 'running' });
    expect(t.entries[0].state).toBe('analyzing');
    t.engine.update('We learn. Practice helps.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(1500);
    expect(t.api.analyze).toHaveBeenCalledTimes(2); expect(t.api.cancel).not.toHaveBeenCalled();
    expect(t.entries.map(e => e.state)).toEqual(['analyzing', 'queued']);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.progress({ requestId: t.requests[0].r.request_id, phase: 'running' });
    expect(t.entries[0].state).toBe('done'); t.engine.dispose();
  });
  it('rechecks changed preceding context and allows an explicit selected-text review', async () => {
    const t = setup(); t.engine.update('We learn. Practice helps.', context); await vi.advanceTimersByTimeAsync(220);
    for (const item of t.requests) item.d.resolve({ ok: true, value: good(item.r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.analyze({ from: 0, to: 9 });
    expect(t.api.analyze).toHaveBeenCalledTimes(3);
    t.engine.update('We teach. Practice helps.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(220);
    expect(t.requests.slice(3).map(({ r }) => r.original_text)).toEqual(['We teach.', 'Practice helps.']); t.engine.dispose();
  });
  it('does not allow a prior document to pollute another document', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.engine.update('We learn.', { ...context, documentId: crypto.randomUUID() });
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0].result).toBeUndefined(); t.engine.dispose();
  });
  it('moves offsets safely, reuses cache, and keeps ignored sentences hidden', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.ignore(t.entries[0].id); t.engine.update('\nWe learn.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(2000);
    expect(t.entries[0].from).toBe(1); expect(t.entries[0].ignored).toBe(true); expect(t.api.analyze).toHaveBeenCalledTimes(1); t.engine.dispose();
  });
  it('invalidates cached results after meaningful context changes', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update('We learn.', { ...context, task: 'New task' }); await vi.advanceTimersByTimeAsync(220);
    expect(t.api.analyze).toHaveBeenCalledTimes(2); t.engine.dispose();
  });
  it('skips incomplete prose and IME composition, resumes after compositionend', async () => {
    const t = setup(); t.engine.update('I think that', context); await vi.advanceTimersByTimeAsync(2000);
    expect(t.api.analyze).not.toHaveBeenCalled();
    t.engine.update('We learn.', context, true); await vi.advanceTimersByTimeAsync(2000); expect(t.api.analyze).not.toHaveBeenCalled();
    t.engine.update('We learn.', context, false); await vi.advanceTimersByTimeAsync(220); expect(t.api.analyze).toHaveBeenCalledTimes(1); t.engine.dispose();
  });
  it('allows manual analysis while paused and retries failures without blocking edits', async () => {
    const t = setup(); t.engine.configure(false, 1200); t.engine.update('I think', context); await vi.advanceTimersByTimeAsync(2000);
    expect(t.api.analyze).not.toHaveBeenCalled(); t.engine.analyze({ from: 0, to: 7 }); expect(t.api.analyze).toHaveBeenCalledTimes(1);
    t.requests[0].d.resolve({ ok: false, error: { code: 'network', message: '网络失败', retryable: true } }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0].state).toBe('error'); t.engine.update('I think learning helps.', context); expect(t.entries[0].text).toBe('I think learning helps.'); t.engine.dispose();
  });
});
