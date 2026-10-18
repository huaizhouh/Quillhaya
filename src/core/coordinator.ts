import type { AnalysisProgress, AnalysisRequest, AnalysisResult, DesktopAPI, Failure, WritingMode } from '../models/schema';
import { splitSentences, type Sentence } from './sentences';
export type FeedbackEntry = Sentence & { signature: string; contextSignature?: string; reviewedContext?: string; contextChanged?: boolean; textChanged?: boolean; edited?: boolean; contextSnapshot?: AnalysisRequest['context']; state: 'pending' | 'queued' | 'analyzing' | 'done' | 'error'; result?: AnalysisResult; error?: Failure; requestId?: string; ignored?: boolean };
export type AnalysisContext = { documentId: string; revision: number; mode: WritingMode; task: string; profileId: string; configVersion: number };

function surrounding(sentences: Sentence[], index: number) {
  return { before: sentences.slice(0, index).filter(s => s.complete).slice(-2).map(s => s.text.slice(0, 3000)),
    after: sentences.slice(index + 1).filter(s => s.complete).slice(0, 1).map(s => s.text.slice(0, 3000)) };
}

function contextChanged(reviewed: AnalysisRequest['context'] | undefined, current: ReturnType<typeof surrounding>) {
  if (!reviewed) return false;
  // A following sentence written after this review is new information, not an
  // edit to its evidence. Compare following context only if it was actually sent.
  // Keep the full context in requests/cache keys so a manual refresh uses it.
  return JSON.stringify(reviewed.before) !== JSON.stringify(current.before) ||
    (reviewed.after.length > 0 && JSON.stringify(reviewed.after) !== JSON.stringify(current.after));
}

export class AnalysisCoordinator {
  private entries: FeedbackEntry[] = [];
  private context?: AnalysisContext;
  private text = '';
  private counter = 0;
  private cache = new Map<string, AnalysisResult>();
  private timer?: ReturnType<typeof setTimeout>;
  private completionTimer?: ReturnType<typeof setTimeout>;
  private revisionTimer?: ReturnType<typeof setTimeout>;
  private enabled = true;
  private disposed = false;
  private debounceMs = 1200;
  private revisionDebounceMs = 3000;
  constructor(private api: Pick<DesktopAPI, 'analyze' | 'cancel'>, private publish: (entries: FeedbackEntry[]) => void) {}
  configure(enabled: boolean, debounceMs: number, revisionDebounceMs = 3000) {
    const resumed = !this.enabled && enabled;
    this.enabled = enabled; this.debounceMs = debounceMs; this.revisionDebounceMs = revisionDebounceMs;
    if (!enabled) { this.clearTimers(); this.cancelAll(); this.emit(); }
    if (resumed) this.schedule();
  }
  update(text: string, context: AnalysisContext, composing = false) {
    if (this.disposed) return;
    const switched = this.context?.documentId !== context.documentId;
    const sameConfiguration = !switched && this.context?.mode === context.mode && this.context?.task === context.task && this.context?.profileId === context.profileId && this.context?.configVersion === context.configVersion;
    if (switched) { this.cancelAll(); this.entries = []; this.cache.clear(); }
    const previousText = switched ? '' : this.text;
    // Only newly inserted sentence terminators qualify for the short trigger.
    // An existing full stop at the end of a sentence does not end an edit in its middle.
    let changedFrom = 0, oldEnd = previousText.length, changedTo = text.length;
    while (changedFrom < oldEnd && changedFrom < changedTo && previousText[changedFrom] === text[changedFrom]) changedFrom++;
    while (oldEnd > changedFrom && changedTo > changedFrom && previousText[oldEnd - 1] === text[changedTo - 1]) { oldEnd--; changedTo--; }
    this.context = context; this.text = text;
    const old = [...this.entries];
    const sentences = splitSentences(text, context.mode);
    // Reserve exact matches first, so an edited sentence cannot steal an
    // unchanged neighbor's feedback. Carry reviews only across an unambiguous
    // one-to-one edit; splits/merges are new review units.
    const matched = sentences.map(sentence => {
      const found = old.findIndex(entry => entry.text === sentence.text);
      return found >= 0 ? old.splice(found, 1)[0] : undefined;
    });
    const changedOld = old.filter(entry => entry.from <= oldEnd && entry.to >= changedFrom);
    const changedNew = sentences.map((sentence, index) => ({ sentence, index })).filter(({ sentence, index }) => !matched[index] && sentence.from <= changedTo && sentence.to >= changedFrom);
    if (changedOld.length === 1 && changedNew.length === 1) {
      matched[changedNew[0].index] = changedOld[0]; old.splice(old.indexOf(changedOld[0]), 1);
    }
    this.entries = sentences.map((sentence, index) => {
      const previous = matched[index];
      const { before, after } = surrounding(sentences, index);
      const contextSignature = JSON.stringify([before, after]);
      // Neighbor edits mark existing reviews stale; only the current text or
      // analysis settings invalidate the review itself. Refresh is explicit.
      const signature = JSON.stringify([sentence.text, context.mode, context.task, context.profileId, context.configVersion]);
      const id = previous?.id ?? `s-${++this.counter}`;
      if (previous?.signature === signature) return { ...previous, ...sentence, id, contextSignature, contextChanged: contextChanged(previous.contextSnapshot, { before, after }) };
      if (previous?.requestId) void this.api.cancel(previous.requestId);
      const cached = this.cache.get(JSON.stringify([signature, contextSignature]));
      const retained = sameConfiguration ? previous?.result : undefined;
      const result = cached ? { ...cached, sentence_id: id } : retained;
      return { ...sentence, id, signature, contextSignature, reviewedContext: cached ? contextSignature : retained ? previous?.reviewedContext : undefined,
        contextSnapshot: cached ? { before, after, task: context.task } : retained ? previous?.contextSnapshot : undefined,
        contextChanged: Boolean(!cached && retained && contextChanged(previous?.contextSnapshot, { before, after })), textChanged: Boolean(result && result.original_text !== sentence.text),
        edited: Boolean(previous && previous.text !== sentence.text && (previous.complete || previous.result || previous.requestId || previous.edited)),
        ignored: previous?.text === sentence.text ? previous.ignored : false, state: cached ? 'done' : 'pending', result };
    });
    for (const removed of old) if (removed.requestId) void this.api.cancel(removed.requestId);
    this.emit();
    this.clearTimers();
    const completed = this.entries.filter(entry => {
      const ending = /[.!?]["'”’)]*$/.exec(entry.text);
      const position = entry.from + (ending?.index ?? -1);
      return !entry.edited && entry.complete && ending && position >= changedFrom && position < changedTo;
    }).map(entry => entry.id);
    if (this.enabled && !composing) this.schedule(completed);
  }
  private schedule(completed: string[] = []) {
    // The short trigger cannot accidentally submit another sentence still being edited.
    if (completed.length) this.completionTimer = setTimeout(() => {
      for (const id of completed) if (this.get(id)?.state === 'pending') this.analyze(undefined, id);
    }, 220);
    this.timer = setTimeout(() => this.analyzePending(false), this.debounceMs);
    this.revisionTimer = setTimeout(() => this.analyzePending(true), this.revisionDebounceMs);
  }
  private analyzePending(edited: boolean) {
    for (const entry of this.entries) if (entry.state === 'pending' && Boolean(entry.edited) === edited) this.analyze(undefined, entry.id);
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
    if (e) {
      e.ignored = true;
      if (e.requestId) { void this.api.cancel(e.requestId); e.requestId = undefined; }
      e.state = 'pending'; e.result = undefined; e.error = undefined;
      e.contextSnapshot = undefined; e.reviewedContext = undefined; e.contextChanged = false; e.textChanged = false;
    }
    this.emit();
  }
  reevaluate(id: string) {
    const entry = this.get(id);
    if (!entry || !entry.complete || entry.requestId || this.disposed) return;
    // Only this explicit action restores an ignored sentence; scheduled runs
    // also use analyze(..., id) and must continue to skip it.
    entry.ignored = false;
    this.analyze(undefined, id);
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
      context: { ...surrounding(this.entries, index), task: context.task }
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
      current.result = reply.value; current.state = 'done'; current.textChanged = false; current.edited = false; current.contextSnapshot = request.context;
      current.reviewedContext = reviewedContext; current.contextChanged = contextChanged(request.context, surrounding(this.entries, this.entries.indexOf(current)));
      this.cache.set(JSON.stringify([signature, reviewedContext]), reply.value);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!);
    } else if (reply.error.code === 'cancelled') current.state = current.result && !current.textChanged ? 'done' : 'pending';
    else { current.state = 'error'; current.error = reply.error; }
    this.emit();
  }
  private cancelAll() {
    for (const e of this.entries) if (e.requestId) { void this.api.cancel(e.requestId); e.requestId = undefined; e.state = e.result && !e.textChanged ? 'done' : 'pending'; }
  }
  private emit() { if (!this.disposed) this.publish(this.entries.map(e => ({ ...e }))); }
  private clearTimers() { clearTimeout(this.timer); clearTimeout(this.completionTimer); clearTimeout(this.revisionTimer); }
  dispose() { this.disposed = true; this.clearTimers(); this.cancelAll(); }
}
