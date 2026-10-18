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
    t.engine.update('He goes home.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(3000);
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
    expect(t.entries[0]).toMatchObject({ id: firstId, state: 'done', contextChanged: false });
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
    expect(t.entries[0]).toMatchObject({ state: 'done', contextChanged: false }); t.engine.dispose();
  });
  it('ignores newly available following context until reviewed, but flags changes to reviewed neighbors', async () => {
    const t = setup(); t.engine.update('We learn. Practice', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update('We learn. Practice helps.', { ...context, revision: 2 });
    expect(t.entries[0].contextChanged).toBe(false);
    expect(t.entries[0].contextSnapshot?.after).toEqual([]);
    t.engine.analyze(undefined, t.entries[0].id);
    expect(t.requests[1].r.context.after).toEqual(['Practice helps.']);
    t.requests[1].d.resolve({ ok: true, value: good(t.requests[1].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update('We learn. Practice helps everyone.', { ...context, revision: 3 });
    expect(t.entries[0].contextChanged).toBe(true);
    t.engine.update('We learn. Practice helps.', { ...context, revision: 4 });
    expect(t.entries[0].contextChanged).toBe(false); t.engine.dispose();
  });
  it('retains neighbor feedback until an explicit refresh, using the latest context', async () => {
    const t = setup(); t.engine.update('We learn. Practice helps.', context); await vi.advanceTimersByTimeAsync(220);
    for (const item of t.requests) item.d.resolve({ ok: true, value: good(item.r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.analyze({ from: 0, to: 9 });
    expect(t.api.analyze).toHaveBeenCalledTimes(3);
    t.engine.update('We teach. Practice helps.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(3000);
    expect(t.requests.slice(3).map(({ r }) => r.original_text)).toEqual(['We teach.']);
    expect(t.entries[1]).toMatchObject({ state: 'done', contextChanged: true, result: { status: 'good' } });
    t.engine.analyze(undefined, t.entries[1].id);
    expect(t.requests[4].r.context.before).toEqual(['We teach.']);
    expect(t.entries[1].result?.status).toBe('good');
    t.requests[4].d.resolve({ ok: true, value: good(t.requests[4].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[1]).toMatchObject({ state: 'done', contextChanged: false }); t.engine.dispose();
  });
  it('marks an in-flight review stale if neighbors change, and clears the mark on undo', async () => {
    const t = setup(); t.engine.update('We learn. Practice helps.', context); await vi.advanceTimersByTimeAsync(220);
    const second = t.requests[1];
    t.engine.update('We teach. Practice helps.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(220);
    expect(t.api.cancel).not.toHaveBeenCalledWith(second.r.request_id);
    second.d.resolve({ ok: true, value: good(second.r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[1]).toMatchObject({ state: 'done', contextChanged: true });
    t.engine.update('We learn. Practice helps.', { ...context, revision: 3 });
    expect(t.entries[1]).toMatchObject({ state: 'done', contextChanged: false }); t.engine.dispose();
  });
  it('retains the old review when a manual refresh fails or is stopped', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.analyze(undefined, t.entries[0].id);
    t.requests[1].d.resolve({ ok: false, error: { code: 'network', message: '网络错误', retryable: true } }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0]).toMatchObject({ state: 'error', result: { status: 'good' } });
    t.engine.analyze(undefined, t.entries[0].id); t.engine.configure(false, 1200);
    expect(t.entries[0]).toMatchObject({ state: 'done', result: { status: 'good' } }); t.engine.dispose();
  });
  it('does not allow a prior document to pollute another document', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.engine.update('We learn.', { ...context, documentId: crypto.randomUUID() });
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0].result).toBeUndefined(); t.engine.dispose();
  });
  it('keeps ignored sentence entries without their review and skips automatic or selection analysis', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.ignore(t.entries[0].id); t.engine.update('\nWe learn.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(2000);
    expect(t.entries).toHaveLength(1); expect(t.entries[0]).toMatchObject({ from: 1, ignored: true, text: 'We learn.' });
    expect(t.entries[0].result).toBeUndefined();
    t.engine.analyze({ from: 0, to: 10 });
    expect(t.api.analyze).toHaveBeenCalledTimes(1);
    t.engine.reevaluate(t.entries[0].id);
    expect(t.entries[0]).toMatchObject({ ignored: false, state: 'queued' });
    expect(t.api.analyze).toHaveBeenCalledTimes(2);
    t.requests[1].d.resolve({ ok: true, value: good(t.requests[1].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0]).toMatchObject({ state: 'done', result: { status: 'good' } }); t.engine.dispose();
  });
  it('cancels an ignored refresh, rejects its late response, and resumes after the sentence changes', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    const id = t.entries[0].id;
    t.engine.reevaluate(id); t.engine.ignore(id);
    expect(t.api.cancel).toHaveBeenCalledWith(t.requests[1].r.request_id);
    t.requests[1].d.resolve({ ok: true, value: good(t.requests[1].r) }); await vi.advanceTimersByTimeAsync(3000);
    expect(t.entries[0]).toMatchObject({ ignored: true, state: 'pending' });
    expect(t.entries[0].result).toBeUndefined(); expect(t.entries[0].requestId).toBeUndefined();
    expect(t.requests).toHaveLength(2);
    t.engine.update('We learn more.', { ...context, revision: 2 });
    expect(t.entries[0].ignored).toBe(false); expect(t.entries[0].result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.requests).toHaveLength(3); expect(t.requests[2].r.original_text).toBe('We learn more.'); t.engine.dispose();
  });
  it('invalidates cached results after meaningful context changes', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update('We learn.', { ...context, task: 'New task' }); await vi.advanceTimersByTimeAsync(1200);
    expect(t.api.analyze).toHaveBeenCalledTimes(2); t.engine.dispose();
  });
  it('skips incomplete prose and IME composition, resumes after compositionend', async () => {
    const t = setup(); t.engine.update('I think that', context); await vi.advanceTimersByTimeAsync(2000);
    expect(t.api.analyze).not.toHaveBeenCalled();
    t.engine.update('We learn.', context, true); await vi.advanceTimersByTimeAsync(2000); expect(t.api.analyze).not.toHaveBeenCalled();
    t.engine.update('We learn.', context, false); await vi.advanceTimersByTimeAsync(1200); expect(t.api.analyze).toHaveBeenCalledTimes(1); t.engine.dispose();
  });
  it('waits for the full idle delay while editing a sentence with an existing period', async () => {
    const t = setup(); t.engine.configure(true, 1200, 1600);
    t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    for (const text of ['We learn a.', 'We learn a lot.', 'We learn a lot together.']) {
      t.engine.update(text, { ...context, revision: ++context.revision });
      await vi.advanceTimersByTimeAsync(500);
      expect(t.requests).toHaveLength(1);
    }
    await vi.advanceTimersByTimeAsync(1099); expect(t.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.requests.map(item => item.r.original_text)).toEqual(['We learn.', 'We learn a lot together.']); t.engine.dispose();
  });
  it('a newly completed sentence does not prematurely submit another edited sentence', async () => {
    const t = setup(); t.engine.update('We learn. We practice', context); await vi.advanceTimersByTimeAsync(220);
    t.requests[0].d.resolve({ ok: true, value: good(t.requests[0].r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update('We learn together. We practice', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(300);
    t.engine.update('We learn together. We practice.', { ...context, revision: 3 }); await vi.advanceTimersByTimeAsync(220);
    expect(t.requests.map(item => item.r.original_text)).toEqual(['We learn.', 'We practice.']);
    await vi.advanceTimersByTimeAsync(2780); expect(t.requests[2].r.original_text).toBe('We learn together.'); t.engine.dispose();
  });
  it('manual reevaluation can submit an edited sentence before its idle delay', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    t.engine.update('We learn more.', { ...context, revision: 2 });
    expect(t.api.cancel).toHaveBeenCalledWith(t.requests[0].r.request_id);
    t.engine.analyze(undefined, t.entries[0].id);
    expect(t.requests[1].r.original_text).toBe('We learn more.'); t.engine.dispose();
  });
  it('allows manual analysis while paused and retries failures without blocking edits', async () => {
    const t = setup(); t.engine.configure(false, 1200); t.engine.update('I think', context); await vi.advanceTimersByTimeAsync(2000);
    expect(t.api.analyze).not.toHaveBeenCalled(); t.engine.analyze({ from: 0, to: 7 }); expect(t.api.analyze).toHaveBeenCalledTimes(1);
    t.requests[0].d.resolve({ ok: false, error: { code: 'network', message: '网络失败', retryable: true } }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0].state).toBe('error'); t.engine.update('I think learning helps.', context); expect(t.entries[0].text).toBe('I think learning helps.'); t.engine.dispose();
  });
  it('retains old advice across edits, waits 3 seconds, and rejects the cancelled refresh response', async () => {
    const t = setup(); t.engine.update('He go home.', context); await vi.advanceTimersByTimeAsync(220);
    const first = good(t.requests[0].r); t.requests[0].d.resolve({ ok: true, value: first }); await vi.advanceTimersByTimeAsync(0);
    const id = t.entries[0].id;
    t.engine.update('He go back home.', { ...context, revision: 2 });
    expect(t.entries[0]).toMatchObject({ id, textChanged: true, state: 'pending', result: first });
    await vi.advanceTimersByTimeAsync(2999); expect(t.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(t.requests).toHaveLength(2); expect(t.entries[0].result).toEqual(first);
    t.engine.update('He goes back home.', { ...context, revision: 3 });
    t.requests[1].d.resolve({ ok: true, value: good(t.requests[1].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0].result).toEqual(first); expect(t.entries[0].textChanged).toBe(true);
    await vi.advanceTimersByTimeAsync(3000); t.requests[2].d.resolve({ ok: true, value: good(t.requests[2].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0]).toMatchObject({ textChanged: false, state: 'done', result: { original_text: 'He goes back home.' } }); t.engine.dispose();
  });
  it('preserves old advice after failed reevaluation and restores the original review on undo', async () => {
    const t = setup(); t.engine.update('We learn.', context); await vi.advanceTimersByTimeAsync(220);
    const first = good(t.requests[0].r); t.requests[0].d.resolve({ ok: true, value: first }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update('We learn together.', { ...context, revision: 2 }); await vi.advanceTimersByTimeAsync(3000);
    t.requests[1].d.resolve({ ok: false, error: { code: 'network', message: '网络错误', retryable: true } }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[0]).toMatchObject({ state: 'error', textChanged: true, result: first });
    t.engine.update('We learn.', { ...context, revision: 3 }); await vi.advanceTimersByTimeAsync(3000);
    expect(t.entries[0]).toMatchObject({ state: 'done', textChanged: false, contextChanged: false, result: first }); expect(t.requests).toHaveLength(2); t.engine.dispose();
  });
  it('never assigns a removed or split sentence review to an unrelated neighbor', async () => {
    const t = setup(); t.engine.update('We learn. They practice.', context); await vi.advanceTimersByTimeAsync(220);
    for (const item of t.requests) item.d.resolve({ ok: true, value: good(item.r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update('We teach. We reflect. They practice.', { ...context, revision: 2 });
    expect(t.entries[0].result).toBeUndefined(); expect(t.entries[1].result).toBeUndefined(); expect(t.entries[2].result?.original_text).toBe('They practice.');
    t.engine.update('They practice.', { ...context, revision: 3 }); expect(t.entries[0].result?.original_text).toBe('They practice.'); t.engine.dispose();
  });
  it('sends the apartment context for automatic review and both current neighbors for manual reevaluation', async () => {
    const t = setup(); const before = 'I recently moved into your apartment, and I found it cozy and comfortable.';
    const current = 'Last day, however, I experienced issues with the heating system.';
    const after = 'Could you arrange a repair?';
    t.engine.update(`${before} ${current}`, { ...context, mode: 'email' }); await vi.advanceTimersByTimeAsync(220);
    expect(t.requests[1].r.context.before).toEqual([before]);
    for (const item of t.requests) item.d.resolve({ ok: true, value: good(item.r) }); await vi.advanceTimersByTimeAsync(0);
    t.engine.update(`${before} ${current} ${after}`, { ...context, mode: 'email', revision: 2 });
    t.engine.analyze(undefined, t.entries[1].id);
    expect(t.requests[2].r.context).toEqual({ before: [before], after: [after], task: '' });
    t.requests[2].d.resolve({ ok: true, value: good(t.requests[2].r) }); await vi.advanceTimersByTimeAsync(0);
    expect(t.entries[1].contextSnapshot).toEqual(t.requests[2].r.context); t.engine.dispose();
  });
  it('reviews an email salutation with the following line as one unit', async () => {
    const t = setup(); t.engine.update('Dear Alex,\nHello. I need help.', { ...context, mode: 'email' }); await vi.advanceTimersByTimeAsync(220);
    expect(t.requests.map(item => item.r.original_text)).toEqual(['Dear Alex,\nHello.', 'I need help.']);
    expect(t.requests[1].r.context.before).toEqual(['Dear Alex,\nHello.']); t.engine.dispose();
  });
});
