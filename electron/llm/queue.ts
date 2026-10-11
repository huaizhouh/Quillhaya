import { abortError, AppError } from './errors';
type Job = { id: string; controller: AbortController; run: (signal: AbortSignal) => Promise<unknown>; resolve: (value: unknown) => void; reject: (reason: unknown) => void };

/** Main-process global limit, shared by analysis and connection tests. */
export class RequestQueue {
  private pending: Job[] = [];
  private active = new Map<string, Job>();
  private nextStart = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private concurrency = 2, private intervalMs = 300) {}
  add<T>(id: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.pending.length >= 200) return Promise.reject(new AppError('queue_full', '待分析内容较多，请稍后重试。', true));
    if (this.active.has(id) || this.pending.some(j => j.id === id)) return Promise.reject(new AppError('duplicate', '请求已在处理中。'));
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ id, run, resolve: resolve as (v: unknown) => void, reject, controller: new AbortController() }); this.pump();
    });
  }
  cancel(id: string) {
    this.active.get(id)?.controller.abort();
    const index = this.pending.findIndex(j => j.id === id);
    if (index >= 0) { const [job] = this.pending.splice(index, 1); job.reject(abortError()); }
  }
  clear() {
    for (const j of this.pending.splice(0)) j.reject(abortError());
    for (const j of this.active.values()) j.controller.abort();
    if (this.timer) clearTimeout(this.timer);
  }
  private pump() {
    if (!this.pending.length || this.active.size >= this.concurrency) return;
    const wait = this.nextStart - Date.now();
    if (wait > 0) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.pump(), wait); return;
    }
    const job = this.pending.shift()!;
    this.active.set(job.id, job); this.nextStart = Date.now() + this.intervalMs;
    Promise.resolve().then(() => job.run(job.controller.signal)).then(job.resolve, job.reject).finally(() => { this.active.delete(job.id); this.pump(); });
    this.pump();
  }
}
