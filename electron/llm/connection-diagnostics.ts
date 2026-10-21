import type { Failure, ModelProfile } from '../../src/models/schema';

const bodyLimit = 1_000_000;
const sensitive = /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret)$/i;
type Attempt = {
  number: number; startedAt: string; elapsedMs: number;
  request: { url: string; method: string; format?: string; headers: Record<string, string> };
  response?: { status: number; statusText: string; headers: Record<string, string>; body: string; truncated: boolean; originalCharacters: number };
  transportError?: string;
};
export type ConnectionReport = {
  id: string; startedAt: string; profile: string; model: string; endpoint: string; timeoutMs: number;
  attempts: Attempt[]; failure?: Failure;
};

/** Opt-in capture for the fixed connection probe only; writing requests never use it. */
export class ConnectionDiagnostics {
  readonly report: ConnectionReport;
  constructor(private profile: ModelProfile, private key?: string) {
    this.report = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), profile: this.redact(profile.name),
      model: this.redact(profile.model), endpoint: this.redact(profile.baseUrl), timeoutMs: profile.timeoutMs, attempts: [] };
  }
  private redact(text: string): string {
    if (this.key) for (const value of new Set([this.key, encodeURIComponent(this.key), JSON.stringify(this.key).slice(1, -1)])) text = text.replaceAll(value, '[已隐藏凭据]');
    return text.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏凭据]');
  }
  private secretField(name: string) { return sensitive.test(name) || (this.profile.auth === 'header' && name.toLowerCase() === this.profile.authHeader.toLowerCase()); }
  private headers(headers: Headers): Record<string, string> {
    return Object.fromEntries([...headers].map(([name, value]) => [name, this.secretField(name) ? '[已隐藏凭据]' : this.redact(value)]));
  }
  private body(text: string): string {
    const clean = this.redact(text);
    try {
      // JSON decoding can reveal a credential hidden behind Unicode escapes.
      return this.redact(JSON.stringify(JSON.parse(clean), (name, value) => this.secretField(name) ? '[已隐藏凭据]' : value, 2));
    } catch { return clean; }
  }
  private error(error: unknown, depth = 0): string {
    if (!(error instanceof Error)) return '请求失败，未提供底层错误信息。';
    const code = (error as NodeJS.ErrnoException).code;
    return this.redact(`${error.name}${code ? ` (${code})` : ''}: ${error.message}`) +
      (error.cause && depth < 3 ? `\n原因：${this.error(error.cause, depth + 1)}` : '');
  }
  fetcher(fetcher: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
      const start = Date.now();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let format: string | undefined;
      try { format = JSON.parse(String(init?.body)).response_format?.type ?? 'text'; } catch { /* e.g. Ollama cleanup GET */ }
      const attempt: Attempt = { number: this.report.attempts.length + 1, startedAt: new Date(start).toISOString(), elapsedMs: 0,
        request: { url: this.redact(url), method: init?.method ?? 'GET', format, headers: this.headers(new Headers(init?.headers)) } };
      this.report.attempts.push(attempt);
      try {
        const response = await fetcher(input, init);
        attempt.response = { status: response.status, statusText: this.redact(response.statusText), headers: this.headers(response.headers), body: '', truncated: false, originalCharacters: 0 };
        try {
          const raw = await response.clone().text();
          const body = this.body(raw);
          attempt.response.body = body.slice(0, bodyLimit);
          attempt.response.originalCharacters = raw.length;
          attempt.response.truncated = body.length > bodyLimit;
        } catch (error) { attempt.transportError = `读取响应正文失败：${this.error(error)}`; }
        return response;
      } catch (error) { attempt.transportError = this.error(error); throw error; }
      finally { attempt.elapsedMs = Date.now() - start; }
    };
  }
  finish(problem: Failure) {
    this.report.failure = { code: problem.code, message: this.redact(problem.message), retryable: problem.retryable };
    return this.report;
  }
}

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
export function diagnosticHTML(report: ConnectionReport): string {
  const pre = (value: unknown) => `<pre>${escape(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>连接测试详情</title>
<style>:root{color-scheme:light dark}body{font:14px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;max-width:1040px;margin:32px auto;padding:0 28px}h1{font-size:24px}h2{font-size:18px;margin-top:32px}h3{font-size:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.7 ui-monospace,monospace;background:light-dark(#f3f5f4,#252a28);padding:16px;border-radius:8px}p{overflow-wrap:anywhere}.muted{color:light-dark(#56645e,#a8b8af)}</style></head><body>
<h1>连接测试详情</h1><p>${escape(report.profile)} / ${escape(report.model)}</p>
${pre({ 时间: report.startedAt, 端点: report.endpoint, 单次超时毫秒: report.timeoutMs, 错误代码: report.failure?.code, 错误原因: report.failure?.message })}
<p class="muted">展示本次连接测试的请求与响应，包括格式回退、重试及模型清理。仅使用固定测试句，不包含作文。凭据已隐藏；内容仅保存在本次运行内存中。可选中文字并使用 ⌘C 复制。</p>
${report.attempts.length ? report.attempts.map(attempt => `<section><h2>请求 ${attempt.number} · ${attempt.response ? `HTTP ${attempt.response.status}` : '未收到 HTTP 响应'} · ${attempt.elapsedMs} ms</h2>
${pre({ 开始时间: attempt.startedAt, ...attempt.request })}
${attempt.transportError ? `<h3>底层错误</h3>${pre(attempt.transportError)}` : ''}
${attempt.response ? `<h3>响应状态与 Headers</h3>${pre({ status: attempt.response.status, statusText: attempt.response.statusText, headers: attempt.response.headers })}<h3>响应正文（凭据脱敏）</h3>${attempt.response.truncated ? '<p>正文超过显示上限，仅展示前 1,000,000 个字符。</p>' : ''}${pre(attempt.response.body || '（空响应正文）')}` : ''}</section>`).join('') : '<p>未发出 HTTP 请求。请根据上方错误原因检查认证、配置或模型状态。</p>'}
</body></html>`;
}
