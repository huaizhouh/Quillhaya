import type { ModelProfile } from '../../src/models/schema';
import { AppError } from './errors';
import { z } from 'zod';

export type ReleaseStatus = 'released' | 'not_resident';
const residentModels = z.object({ models: z.array(z.object({ name: z.string().min(1).optional(), model: z.string().min(1).optional() }).refine(item => item.name || item.model)) });
// Untagged names refer to :latest; a registry's port is not a model tag.
const modelName = (name: string) => name.slice(name.lastIndexOf('/') + 1).includes(':') ? name : `${name}:latest`;

export function ollamaReleaseUrl(profile: ModelProfile) {
  const base = profile.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${base}/api/generate`;
}

/** Release just this model, without stopping the Ollama service or deleting files. */
export async function releaseOllama(profile: ModelProfile, key?: string, fetcher: typeof fetch = fetch): Promise<ReleaseStatus> {
  if (profile.kind !== 'ollama') throw new AppError('unsupported', '该服务不支持 Ollama 模型释放接口。');
  if (profile.auth !== 'none' && !key) throw new AppError('missing_key', '释放模型需要该端点的认证凭据。');
  const headers: Record<string, string> = { ...profile.headers, 'Content-Type': 'application/json' };
  if (key && profile.auth === 'bearer') headers.Authorization = `Bearer ${key}`;
  if (key && profile.auth === 'header') headers[profile.authHeader] = key;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(ollamaReleaseUrl(profile), { method: 'POST', headers, redirect: 'error', signal: controller.signal,
      body: JSON.stringify({ model: profile.model, keep_alive: 0, stream: false }) });
    if (response.status === 404) {
      // A renamed/deleted former model may be in our history. A 404 alone is
      // ambiguous; only a valid resident list can confirm it is already absent.
      const status = await fetcher(ollamaReleaseUrl(profile).replace(/\/generate$/, '/ps'), { method: 'GET', headers, redirect: 'error', signal: controller.signal });
      const parsed = status.ok ? residentModels.safeParse(await status.json()) : null;
      if (parsed?.success && !parsed.data.models.some(item => [item.name, item.model].some(name => name && modelName(name) === modelName(profile.model)))) return 'not_resident';
      throw new AppError('release_failed', '释放接口返回 HTTP 404，且未能确认该模型已不在内存，请检查模型 ID 或 Ollama 原生接口。', true);
    }
    if (!response.ok) throw new AppError('release_failed', `释放模型失败（HTTP ${response.status}），请检查 Ollama 原生接口及认证。`, true);
    const result = await response.json() as { done?: boolean; done_reason?: string };
    if (result?.done !== true || result.done_reason !== 'unload') throw new AppError('release_failed', '服务未确认模型已释放，请检查 Ollama 原生接口。', true);
    return 'released';
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('release_failed', controller.signal.aborted ? '释放模型超时，请稍后重试。' : '无法确认模型已释放，请检查 Ollama 服务后重试。', true);
  } finally { clearTimeout(timer); }
}
