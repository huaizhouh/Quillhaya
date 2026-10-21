import { describe, expect, it, vi } from 'vitest';
import { ConnectionDiagnostics, diagnosticHTML } from '../../electron/llm/connection-diagnostics';
import { CompatibleProvider } from '../../electron/llm/provider';
import { testProfile } from './fixtures';

describe('connection failure diagnostics', () => {
  it('retains complete empty-content responses from both the original and repair requests', async () => {
    const content = { choices: [{ message: { content: null, reasoning: 'upstream reasoning' }, finish_reason: 'length' }], usage: { completion_tokens: 123 } };
    const diagnostics = new ConnectionDiagnostics(testProfile);
    const transport = vi.fn(async () => new Response(JSON.stringify(content), { headers: { 'x-request-id': 'upstream-123' } }));
    await expect(new CompatibleProvider(testProfile, undefined, diagnostics.fetcher(transport)).testConnection(new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_json' });
    expect(diagnostics.report.attempts).toHaveLength(2);
    for (const attempt of diagnostics.report.attempts) {
      expect(attempt.response).toMatchObject({ status: 200, truncated: false, headers: { 'x-request-id': 'upstream-123' } });
      expect(JSON.parse(attempt.response!.body)).toEqual(content);
    }
  });
  it('preserves a full non-JSON HTTP error beyond the short user-facing summary', async () => {
    const body = '<html>gateway failed ' + 'x'.repeat(7000) + ' END</html>';
    const diagnostics = new ConnectionDiagnostics(testProfile);
    const transport = vi.fn(async () => new Response(body, { status: 400, statusText: 'Bad Request' }));
    await expect(new CompatibleProvider(testProfile, undefined, diagnostics.fetcher(transport)).testConnection(new AbortController().signal)).rejects.toMatchObject({ code: 'bad_request' });
    expect(diagnostics.report.attempts[0].response?.body).toBe(body);
    const html = diagnosticHTML(diagnostics.finish({ code: 'bad_request', message: '请求失败', retryable: false }));
    expect(html).toContain('&lt;html&gt;'); expect(html).not.toContain('<html>gateway');
  });
  it('redacts credentials in headers, bodies, encoded echoes and network causes', async () => {
    const key = 'synthetic-credential+/value';
    const diagnostics = new ConnectionDiagnostics({ ...testProfile, auth: 'header', authHeader: 'x-auth' }, key);
    const body = JSON.stringify({ echo: key, encoded: encodeURIComponent(key), api_key: 'unknown-server-secret', usage: { total_tokens: 3 } }).replace('synthetic-credential', '\\u0073ynthetic-credential');
    const fetcher = diagnostics.fetcher(async () => new Response(body, { headers: { 'set-cookie': 'session=private', 'x-echo': key } }));
    await fetcher('http://localhost/v1', { headers: { 'x-auth': key } });
    const serialized = JSON.stringify(diagnostics.report);
    for (const value of [key, encodeURIComponent(key), 'unknown-server-secret', 'session=private']) expect(serialized).not.toContain(value);
    expect(serialized).toContain('total_tokens');
    const error = new TypeError(`fetch failed ${key}`, { cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) });
    await expect(diagnostics.fetcher(async () => { throw error; })('http://localhost')).rejects.toBe(error);
    expect(diagnostics.report.attempts[1].transportError).toContain('ECONNREFUSED');
    expect(diagnostics.report.attempts[1].transportError).not.toContain(key);
  });
  it('escapes response scripts and clearly identifies truncation or pre-request failure', async () => {
    const diagnostics = new ConnectionDiagnostics(testProfile);
    await diagnostics.fetcher(async () => new Response('<script>attack()</script>' + 'x'.repeat(1_000_000)))('http://localhost');
    const html = diagnosticHTML(diagnostics.finish({ code: 'invalid_json', message: '格式错误', retryable: true }));
    expect(html).toContain('正文超过显示上限'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    const empty = new ConnectionDiagnostics(testProfile);
    expect(diagnosticHTML(empty.finish({ code: 'missing_key', message: '尚未配置密钥', retryable: false }))).toContain('未发出 HTTP 请求');
  });
});
