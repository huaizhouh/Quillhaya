import type { AnalysisProgress, AnalysisRequest, AnalysisResult, DesktopAPI, Failure, WritingMode } from '../models/schema';
import { splitSentences, type Sentence } from './sentences';
export type FeedbackEntry = Sentence & { signature: string; contextSignature?: string; reviewedContext?: string; contextChanged?: boolean; state: 'pending' | 'queued' | 'analyzing' | 'done' | 'error'; result?: AnalysisResult; error?: Failure; requestId?: string; ignored?: boolean };
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
    const previousText = switched ? '' : this.text;
    // Only newly inserted sentence terminators qualify for the short trigger.
    // An existing full stop at the end of a sentence does not end an edit in its middle.
    let changedFrom = 0, oldEnd = previousText.length, changedTo = text.length;
    while (changedFrom < oldEnd && changedFrom < changedTo && previousText[changedFrom] === text[changedFrom]) changedFrom++;
    while (oldEnd > changedFrom && changedTo > changedFrom && previousText[oldEnd - 1] === text[changedTo - 1]) { oldEnd--; changedTo--; }
    this.context = context; this.text = text;
    const old = [...this.entries];
    const sentences = splitSentences(text);
    this.entries = sentences.map((sentence, index) => {
      const found = old.findIndex(e => e.text === sentence.text);
      const previous = found >= 0 ? old.splice(found, 1)[0] : undefined;
      const before = sentences.slice(Math.max(0, index - 2), index).filter(s => s.complete).map(s => s.text.slice(0, 3000));
      const after = sentences.slice(index + 1, index + 2).filter(s => s.complete).map(s => s.text.slice(0, 3000));
      const contextSignature = JSON.stringify([before, after]);
      // Neighbor edits mark existing reviews stale; only the current text or
      // analysis settings invalidate the review itself. Refresh is explicit.
      const signature = JSON.stringify([sentence.text, context.mode, context.task, context.profileId, context.configVersion]);
      const id = previous?.id ?? `s-${++this.counter}`;
      if (previous?.signature === signature) return { ...previous, ...sentence, id, contextSignature, contextChanged: previous.reviewedContext !== undefined && previous.reviewedContext !== contextSignature };
      if (previous?.requestId) void this.api.cancel(previous.requestId);
      const cached = this.cache.get(JSON.stringify([signature, contextSignature]));
      return { ...sentence, id, signature, contextSignature, reviewedContext: cached ? contextSignature : undefined, contextChanged: false, ignored: previous?.ignored, state: cached ? 'done' : 'pending', result: cached ? { ...cached, sentence_id: id } : undefined };
    });
    for (const removed of old) if (removed.requestId) void this.api.cancel(removed.requestId);
    this.emit();
    this.clearTimers();
    const completed = this.entries.filter(entry => {
      const ending = /[.!?]["'”’)]*$/.exec(entry.text);
      const position = entry.from + (ending?.index ?? -1);
      return entry.complete && ending && position >= changedFrom && position < changedTo;
    }).map(entry => entry.id);
    if (this.enabled && !composing) this.schedule(completed);
  }
  private schedule(completed: string[] = []) {
    // The short trigger cannot accidentally submit another sentence still being edited.
    if (completed.length) this.completionTimer = setTimeout(() => {
      for (const id of completed) if (this.get(id)?.state === 'pending') this.analyze(undefined, id);
    }, 220);
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
  stop() { this.clearTimers(); this.cancelAll(); this.emit(); }
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
    const reviewedContext = entry.contextSignature;
    entry.state = 'queued'; entry.requestId = requestId; entry.error = undefined; this.emit();
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
      current.reviewedContext = reviewedContext; current.contextChanged = current.contextSignature !== reviewedContext;
      this.cache.set(JSON.stringify([signature, reviewedContext]), reply.value);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    } else if (reply.error.code === 'cancelled') current.state = current.result ? 'done' : 'pending';
    else { current.state = 'error'; current.error = reply.error; }
    this.emit();
  }
  private cancelAll() {
    for (const e of this.entries) if (e.requestId) { void this.api.cancel(e.requestId); e.requestId = undefined; e.state = e.result ? 'done' : 'pending'; }
  }
  private emit() { if (!this.disposed) this.publish(this.entries.map(e => ({ ...e }))); }
  private clearTimers() { clearTimeout(this.timer); clearTimeout(this.completionTimer); }
  dispose() { this.disposed = true; this.clearTimers(); this.cancelAll(); }
}
