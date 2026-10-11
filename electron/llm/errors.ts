import type { Failure } from '../../src/models/schema';
export class AppError extends Error {
  constructor(public code: string, message: string, public retryable = false) { super(message); }
}
export function failure(error: unknown): Failure {
  if (error instanceof AppError) return { code: error.code, message: error.message, retryable: error.retryable };
  if (error instanceof Error && error.name === 'AbortError') return { code: 'cancelled', message: '分析已取消', retryable: false };
  // Never forward raw provider bodies, system paths, keys or headers to the UI/logs.
  return { code: 'internal', message: '操作未完成，请检查配置或重试。', retryable: false };
}
export function abortError() { return new DOMException('Cancelled', 'AbortError'); }
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
