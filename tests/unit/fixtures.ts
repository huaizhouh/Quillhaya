import { type AnalysisRequest, type AnalysisResult, makeProfile } from '../../src/models/schema';
export function request(text = 'Learning takes practice.'): AnalysisRequest {
  return { request_id: crypto.randomUUID(), document_id: crypto.randomUUID(), sentence_id: 's-1', revision_id: 1, from: 0, to: text.length, original_text: text, scope: 'sentence', mode: 'discussion', context: { before: [], after: [], task: '' }, profile_id: 'test' };
}
export function good(r: AnalysisRequest): AnalysisResult {
  return { sentence_id: r.sentence_id, original_text: r.original_text, status: 'good', suggested_revision: null, overall_explanation_zh: '表达良好，无需修改。', issues: [], confidence: 0.9 };
}
export const testProfile = { ...makeProfile('custom', 'test'), auth: 'none' as const, timeoutMs: 1000 };
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
