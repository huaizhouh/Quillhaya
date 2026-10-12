import type { ModelProfile, StopModelsResult } from '../../src/models/schema';
import { AppError, failure } from './errors';
import { ollamaReleaseUrl, type ReleaseStatus } from './ollama';
import { RequestQueue, serialKey } from './queue';

/** Main-process ownership of this application's inference and model residency. */
export class ModelRuntime {
  private used = new Map<string, { profile: ModelProfile; release: () => Promise<ReleaseStatus | void> }>();
  private testing = false;
  private stopping?: Promise<StopModelsResult>;
  constructor(private queue: RequestQueue) {}
  private key(profile: ModelProfile) { return JSON.stringify([ollamaReleaseUrl(profile), profile.model]); }
  track(profile: ModelProfile, release?: () => Promise<ReleaseStatus | void>) {
    if (profile.kind === 'ollama' && release) this.used.set(this.key(profile), { profile, release });
  }
  assertAvailable() {
    if (this.stopping || this.testing) throw new AppError('model_busy', '正在测试或释放模型，请完成后重新评估。', true);
  }
  async test(id: string, profile: ModelProfile, run: (signal: AbortSignal) => Promise<string>, release?: () => Promise<ReleaseStatus | void>) {
    this.assertAvailable(); this.testing = true;
    // No background review of the default profile may overlap the selected test.
    this.queue.clear();
    try {
      return await this.queue.add(id, async signal => {
        this.track(profile, release);
        let result = '', problem: unknown, cleanup = '';
        try { result = await run(signal); } catch (error) { problem = error; }
        if (release) {
          try { const status = await release(); cleanup = status === 'not_resident' ? ' 测试模型已不在 Ollama 内存中。' : ' 测试模型已从 Ollama 内存中释放。'; this.used.delete(this.key(profile)); }
          catch (error) {
            throw new AppError('release_failed', `${problem ? failure(problem).message : '连接测试成功'}；${failure(error).message} 可点击“停止并释放模型”重试。`, true);
          }
        }
        if (problem) {
          if (!release) throw problem;
          const error = failure(problem);
          throw new AppError(error.code, error.message + cleanup, error.retryable);
        }
        return result + cleanup;
      }, serialKey(profile));
    } finally { this.testing = false; }
  }
  stop(): Promise<StopModelsResult> {
    if (this.stopping) return this.stopping;
    // Set the gate synchronously before any request can enter between cancel and unload.
    this.stopping = Promise.resolve().then(async () => {
      this.queue.clear(); await this.queue.whenIdle();
      const result: StopModelsResult = { released: [], alreadyReleased: [], failed: [] };
      for (const [key, item] of this.used) {
        try { const status = await item.release(); (status === 'not_resident' ? result.alreadyReleased : result.released).push(item.profile.model); this.used.delete(key); }
        catch (error) { result.failed.push({ model: item.profile.model, message: failure(error).message }); }
      }
      return result;
    }).finally(() => { this.stopping = undefined; });
    return this.stopping;
  }
}
