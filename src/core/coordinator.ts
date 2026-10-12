import type { AnalysisProgress, AnalysisRequest, AnalysisResult, DesktopAPI, Failure, WritingMode } from '../models/schema';
import { splitSentences, type Sentence } from './sentences';
export type FeedbackEntry = Sentence & { signature: string; state: 'pending' | 'queued' | 'analyzing' | 'done' | 'error'; result?: AnalysisResult; error?: Failure; requestId?: string; ignored?: boolean };
export type AnalysisContext = { documentId: string; revision: number; mode: WritingMode; task: string; profileId: string; configVersion: number };

export class AnalysisCoordinator {
  private entries: FeedbackEntry[] = [];
  private context?: AnalysisContext;
  private text = '';
  private counter = 0;
  private cache = new Map<string, AnalysisResult>();
  private timer?: ReturnType<typeof setTimeout>;
  private completionTimer?: ReturnType<typeof setTimeout>;
  private enabled = true;
  private disposed = false;
  private debounceMs = 1200;
  constructor(private api: Pick<DesktopAPI, 'analyze' | 'cancel'>, private publish: (entries: FeedbackEntry[]) => void) {}
  configure(enabled: boolean, debounceMs: number) {
    const resumed = !this.enabled && enabled;
    this.enabled = enabled; this.debounceMs = debounceMs;
    if (!enabled) { this.clearTimers(); this.cancelAll(); this.emit(); }
    if (resumed) this.schedule();
  }
  update(text: string, context: AnalysisContext, composing = false) {
    if (this.disposed) return;
    const switched = this.context?.documentId !== context.documentId;
    if (switched) { this.cancelAll(); this.entries = []; this.cache.clear(); }
    this.context = context; this.text = text;
    const old = [...this.entries];
    const sentences = splitSentences(text);
    this.entries = sentences.map((sentence, index) => {
      const found = old.findIndex(e => e.text === sentence.text);
      const previous = found >= 0 ? old.splice(found, 1)[0] : undefined;
      const before = sentences.slice(Math.max(0, index - 2), index).filter(s => s.complete).map(s => s.text.slice(0, 3000));
      // Forward context is a request-time hint, not an automatic invalidation trigger.
      // Continuing to write must not cancel or repeat a review of unchanged earlier text.
      const signature = JSON.stringify([sentence.text, before, context.mode, context.task, context.profileId, context.configVersion]);
      const id = previous?.id ?? `s-${++this.counter}`;
      if (previous?.signature === signature) return { ...previous, ...sentence, id };
      if (previous?.requestId) void this.api.cancel(previous.requestId);
      const cached = this.cache.get(signature);
      return { ...sentence, id, signature, ignored: previous?.ignored, state: cached ? 'done' : 'pending', result: cached ? { ...cached, sentence_id: id } : undefined };
    });
    for (const removed of old) if (removed.requestId) void this.api.cancel(removed.requestId);
    this.emit();
    this.clearTimers();
    if (this.enabled && !composing) this.schedule();
  }
  private schedule() {
    // Punctuation uses a short merge window; pause uses the configured debounce.
    this.completionTimer = setTimeout(() => this.analyze(), 220);
    this.timer = setTimeout(() => this.analyze(), this.debounceMs);
  }
  analyze(range?: { from: number; to: number }, retryId?: string) {
    for (const e of this.entries) {
      if (e.ignored || (!e.complete && !range) || e.requestId) continue;
      if (retryId && e.id !== retryId) continue;
      if (range && (e.to <= range.from || e.from >= range.to)) continue;
      if (e.state !== 'pending' && !retryId && !range) continue;
      void this.run(e);
    }
  }
  ignore(id: string) {
    const e = this.entries.find(e => e.id === id);
    if (e) { e.ignored = true; if (e.requestId) { void this.api.cancel(e.requestId); e.requestId = undefined; } }
    this.emit();
  }
  get(id: string) { return this.entries.find(e => e.id === id); }
  progress(progress: AnalysisProgress) {
    const entry = this.entries.find(e => e.requestId === progress.requestId);
    if (!entry || entry.ignored || this.disposed) return;
    entry.state = progress.phase === 'running' ? 'analyzing' : 'queued';
    this.emit();
  }
  private async run(entry: FeedbackEntry) {
    const context = this.context!;
    const index = this.entries.indexOf(entry);
    const requestId = crypto.randomUUID();
    const signature = entry.signature;
    entry.state = 'queued'; entry.requestId = requestId; entry.error = undefined; entry.result = undefined; this.emit();
    const request: AnalysisRequest = {
      request_id: requestId, document_id: context.documentId, revision_id: context.revision,
      sentence_id: entry.id, original_text: entry.text, from: entry.from, to: entry.to,
      mode: context.mode, scope: 'sentence', profile_id: context.profileId,
      context: { before: this.entries.slice(Math.max(0, index - 2), index).filter(s => s.complete).map(s => s.text.slice(0, 3000)), after: this.entries.slice(index + 1, index + 2).filter(s => s.complete).map(s => s.text.slice(0, 3000)), task: context.task }
    };
    let reply;
    try { reply = await this.api.analyze(request); }
    catch { reply = { ok: false as const, error: { code: 'ipc', message: '分析服务暂时不可用，请重试。', retryable: true } }; }
    if (this.disposed || this.context?.documentId !== context.documentId) return;
    const current = this.entries.find(e => e.id === entry.id);
    if (!current || current.signature !== signature || current.requestId !== requestId || current.ignored || this.text.slice(current.from, current.to) !== request.original_text) return;
    current.requestId = undefined;
    if (reply.ok) {
      if (reply.value.original_text !== current.text || reply.value.sentence_id !== current.id) return;
      current.result = reply.value; current.state = 'done';
      this.cache.set(signature, reply.value);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    } else if (reply.error.code === 'cancelled') current.state = 'pending';
    else { current.state = 'error'; current.error = reply.error; }
    this.emit();
  }
  private cancelAll() {
    for (const e of this.entries) if (e.requestId) { void this.api.cancel(e.requestId); e.requestId = undefined; e.state = 'pending'; }
  }
  private emit() { if (!this.disposed) this.publish(this.entries.map(e => ({ ...e }))); }
  private clearTimers() { clearTimeout(this.timer); clearTimeout(this.completionTimer); }
  dispose() { this.disposed = true; this.clearTimers(); this.cancelAll(); }
}
