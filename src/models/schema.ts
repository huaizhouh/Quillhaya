import { z } from 'zod';

export const ModeSchema = z.enum(['discussion', 'email', 'general']);
export type WritingMode = z.infer<typeof ModeSchema>;
export const modeLabels: Record<WritingMode, string> = {
  discussion: 'Academic Discussion', email: 'Email Writing', general: 'General English'
};
const chinese = z.string().min(1).max(4000).refine(s => /[\u3400-\u9fff]/u.test(s), '解释必须包含中文');
export const IssueSchema = z.object({
  type: z.enum(['grammar', 'spelling', 'word_choice', 'collocation', 'clarity', 'conciseness', 'tone', 'coherence', 'task_relevance']),
  severity: z.enum(['error', 'improvement']),
  original_span: z.string().min(1).max(3000),
  suggested_text: z.string().max(4000),
  explanation_zh: chinese
}).strict();
export const ResultSchema = z.object({
  sentence_id: z.string().min(1).max(100),
  original_text: z.string().min(1).max(50_000),
  status: z.enum(['good', 'needs_revision', 'incomplete', 'error']),
  overall_explanation_zh: chinese,
  suggested_revision: z.string().min(1).max(50_000).nullable(),
  issues: z.array(IssueSchema).max(3),
  confidence: z.number().min(0).max(1)
}).strict().superRefine((r, ctx) => {
  if (r.status !== 'needs_revision' && (r.suggested_revision !== null || r.issues.length))
    ctx.addIssue({ code: 'custom', message: '无修改建议的状态不得附带改写或问题' });
  if (r.status === 'needs_revision' && !r.issues.length)
    ctx.addIssue({ code: 'custom', message: '修改建议必须有问题解释' });
});
export type AnalysisResult = z.infer<typeof ResultSchema>;
export type Issue = z.infer<typeof IssueSchema>;

export const RequestSchema = z.object({
  request_id: z.string().uuid(), document_id: z.string().uuid(),
  revision_id: z.number().int().nonnegative(), sentence_id: z.string().min(1).max(100),
  original_text: z.string().min(1).max(50_000),
  from: z.number().int().nonnegative(), to: z.number().int().nonnegative(),
  mode: ModeSchema, scope: z.enum(['sentence', 'document']),
  context: z.object({ before: z.array(z.string().max(3000)).max(2), after: z.array(z.string().max(3000)).max(1), task: z.string().max(6000) }).strict(),
  profile_id: z.string().max(100)
}).strict().refine(r => r.to - r.from === r.original_text.length, '本地文本范围不匹配');
export type AnalysisRequest = z.infer<typeof RequestSchema>;
export type Failure = { code: string; message: string; retryable: boolean; detailsId?: string };
export type Reply<T> = { ok: true; value: T } | { ok: false; error: Failure };

export const ProviderKindSchema = z.enum(['mock', 'openai', 'openrouter', 'ollama', 'lmstudio', 'vllm', 'llamacpp', 'custom']);
export const ProfileSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: z.string().min(1).max(80),
  kind: ProviderKindSchema,
  baseUrl: z.string().max(2048).refine(value => {
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
  }, '请输入不含认证信息或查询参数的 HTTP(S) 地址'),
  model: z.string().min(1).max(200),
  auth: z.enum(['none', 'bearer', 'header']),
  authHeader: z.string().regex(/^[A-Za-z0-9-]+$/).max(100),
  envKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(100).or(z.literal('')),
  headers: z.record(z.string().max(2000)).refine(h => Object.keys(h).length <= 10 && Object.entries(h).every(([k, v]) =>
    /^[A-Za-z0-9-]+$/.test(k) && !/authorization|cookie|key|token|secret|host|content-length|connection|proxy/i.test(k) && !/[\r\n]/.test(v)), '附加 headers 不得包含认证凭据或传输控制字段'),
  temperature: z.number().min(0).max(2).nullable(), timeoutMs: z.number().int().min(1000).max(120_000),
  extraSystemPrompt: z.string().max(6000).default(''),
  mockBehavior: z.enum(['normal', 'error', 'slow'])
}).strict();
export type ModelProfile = z.infer<typeof ProfileSchema>;
export const SettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']), fontSize: z.number().int().min(14).max(26),
  debounceMs: z.number().int().min(300).max(10_000), autoAnalyze: z.boolean(),
  revisionDebounceMs: z.number().int().min(1000).max(30_000).default(3000),
  defaultProfileId: z.string().max(100), profiles: z.array(ProfileSchema).min(1).max(25)
}).strict().refine(s => s.profiles.some(p => p.id === s.defaultProfileId) && new Set(s.profiles.map(p => p.id)).size === s.profiles.length, '默认配置不存在或配置 ID 重复');
export type Settings = z.infer<typeof SettingsSchema>;
export const DocumentSchema = z.object({
  id: z.string().uuid(), text: z.string().max(500_000), task: z.string().max(6000),
  mode: ModeSchema, name: z.string().max(300), dirty: z.boolean(), hasFile: z.boolean().optional()
}).strict();
export type WritingDocument = z.infer<typeof DocumentSchema>;
export type MenuCommand = 'new' | 'open' | 'save' | 'saveAs' | 'settings' | 'close';
export type AnalysisProgress = { requestId: string; phase: 'queued' | 'running' };
export type ContextMenuRequest = { id: string; x: number; y: number };
export type StopModelsResult = { released: string[]; alreadyReleased: string[]; failed: { model: string; message: string }[] };
export type Bootstrap = { settings: Settings; document: WritingDocument | null; restored: boolean; keyStatus: Record<string, boolean>; storageNotice?: string };

export const presetInfo: Record<ModelProfile['kind'], { name: string; url: string; model: string; auth: ModelProfile['auth']; envKey: string }> = {
  mock: { name: 'Mock 演示', url: 'http://127.0.0.1', model: 'demo-grammar', auth: 'none', envKey: '' },
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', auth: 'bearer', envKey: 'OPENAI_API_KEY' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', auth: 'bearer', envKey: 'OPENROUTER_API_KEY' },
  ollama: { name: 'Ollama', url: 'http://127.0.0.1:11434/v1', model: 'llama3.2', auth: 'none', envKey: '' },
  lmstudio: { name: 'LM Studio', url: 'http://127.0.0.1:1234/v1', model: 'local-model', auth: 'none', envKey: '' },
  vllm: { name: 'vLLM', url: 'http://127.0.0.1:8000/v1', model: 'local-model', auth: 'none', envKey: '' },
  llamacpp: { name: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', model: 'local-model', auth: 'none', envKey: '' },
  custom: { name: 'Custom', url: 'http://127.0.0.1:8000/v1', model: 'your-model', auth: 'bearer', envKey: '' }
};
export function makeProfile(kind: ModelProfile['kind'], id = kind as string): ModelProfile {
  const p = presetInfo[kind];
  return { id, kind, name: p.name, baseUrl: p.url, model: p.model, auth: p.auth, envKey: p.envKey, authHeader: 'x-api-key', headers: {}, temperature: null, timeoutMs: 30_000, extraSystemPrompt: '', mockBehavior: 'normal' };
}
export const defaultSettings: Settings = { theme: 'system', fontSize: 18, debounceMs: 1200, revisionDebounceMs: 3000, autoAnalyze: true, defaultProfileId: 'mock', profiles: [makeProfile('mock')] };

export interface DesktopAPI {
  bootstrap(): Promise<Reply<Bootstrap>>;
  saveSettings(settings: Settings, keys: Record<string, string | null>): Promise<Reply<{ settings: Settings; keyStatus: Record<string, boolean>; analysisChanged: boolean }>>;
  testConnection(profile: ModelProfile, key?: string, requestId?: string): Promise<Reply<string>>;
  showConnectionDetails(id: string): Promise<Reply<void>>;
  stopModels(profile?: ModelProfile, key?: string): Promise<Reply<StopModelsResult>>;
  analyze(request: AnalysisRequest): Promise<Reply<AnalysisResult>>;
  cancel(requestId: string): Promise<void>;
  draft(document: WritingDocument): Promise<Reply<void>>;
  open(): Promise<Reply<WritingDocument | null>>;
  checkFile(id: string): Promise<Reply<{ hasFile: boolean }>>;
  save(document: WritingDocument, saveAs: boolean): Promise<Reply<{ name: string } | null>>;
  confirmDiscard(): Promise<Reply<'save' | 'discard' | 'cancel'>>;
  close(document: WritingDocument): Promise<Reply<void>>;
  cancelClose(): Promise<Reply<void>>;
  rendererFailed(document?: WritingDocument): Promise<Reply<void>>;
  copy(text: string): Promise<Reply<void>>;
  showContextMenu(id: string, sentenceId?: string): Promise<Reply<void>>;
  onContextMenu(callback: (request: ContextMenuRequest) => void): () => void;
  onLocateFeedback(callback: (sentenceId: string) => void): () => void;
  onMenu(callback: (command: MenuCommand) => void): () => void;
  onAnalysisProgress(callback: (progress: AnalysisProgress) => void): () => void;
}
declare global { interface Window { desktop: DesktopAPI } }
