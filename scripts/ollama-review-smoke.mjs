// Opt-in quality/context regression using fixed examples, never a draft.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settings = JSON.parse(await readFile(process.env.TWA_OLLAMA_SETTINGS ?? join(homedir(), 'Library/Application Support/TOEFL Writing Assistant/settings.json'), 'utf8'));
const profile = settings.profiles.find(p => p.id === (process.env.TWA_OLLAMA_PROFILE ?? settings.defaultProfileId));
assert(profile?.kind === 'ollama' && profile.auth === 'none');
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.baseUrl).hostname));
const base = profile.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
const ps = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(5000) }); assert(ps.ok);
const wasResident = (await ps.json()).models.some(item => [item.name, item.model].includes(profile.model));
assert(!wasResident, 'Test model is already resident; finish the existing session before this opt-in check.');
const directory = await mkdtemp(join(tmpdir(), 'twa-review-'));
let provider;
try {
  const bundle = await build({ stdin: { contents: "export * from './electron/llm/provider'; export * from './src/core/sentences';", resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const modulePath = join(directory, 'review.mjs'); await writeFile(modulePath, bundle.outputFiles[0].text);
  const { CompatibleProvider, splitSentences } = await import(pathToFileURL(modulePath).href);
  const payloads = [];
  provider = new CompatibleProvider(profile, undefined, (url, options) => { if (url.endsWith('/chat/completions')) payloads.push(JSON.parse(options.body)); return fetch(url, options); });
  const before = 'I recently moved into your apartment, and I found it cozy and comfortable.';
  const however = 'Last day, however, I experienced issues with the heating system.';
  const grammar = 'I cannot bear the freeze water and it truly trouble my experience of showering in the evening.';
  const verifyTrouble = result => assert(result.issues.some(issue => issue.severity === 'error' && issue.type === 'grammar' && /\btrouble\b/i.test(issue.original_span) && /\btroubles\b/i.test(issue.suggested_text)), 'Expected an explicit present-tense trouble → troubles correction, not just a grammar label or an arbitrary tense change.');
  const suite = process.argv[2] === 'issue1014' ? 'issue1014' : 'issue1013';
  const cases = suite === 'issue1014' ? [
    { text: 'The teachers said the lesson was useful.', before: [], after: [], verify: result => assert(!result.issues.some(issue => issue.type === 'grammar'), 'Correct past-tense said must not be reported as a grammar error.') },
    { text: 'I would really appreciate it very much if we could discuss it in person.', before: [], after: [], verify: result => {
      assert(result.issues.some(issue => issue.severity === 'improvement'), 'Useful optional expression advice must remain.');
      assert(!result.issues.some(issue => issue.type === 'grammar'), 'Redundant but grammatical wording must not become a grammar error.');
    } },
    { text: "Please let me know if you'd like to discuss it in person.", before: [], after: [], verify: result => assert(!result.issues.some(issue => issue.type === 'grammar'), 'A polite valid expression must not become a grammar error.') },
    { text: grammar, before: [however], after: [], verify: verifyTrouble },
    { text: 'He go to work every day on a daily basis.', before: [], after: [], verify: result => {
      assert(result.issues.some(issue => issue.type === 'grammar' && issue.severity === 'error'), 'Expected the genuine agreement error.');
      assert(result.issues.some(issue => issue.severity === 'improvement'), 'Mixed feedback must retain the optional redundancy improvement.');
    } }
  ] : [
    { text: however, before: [before], after: [], verify: result => assert.match(result.suggested_revision ?? result.original_text, /however/i) },
    { text: grammar, before: [however], after: [], verify: verifyTrouble },
    { text: however, before: [before], after: ['Could you arrange a repair?'], verify: result => assert.match(result.suggested_revision ?? result.original_text, /however/i) },
    { text: splitSentences('Dear Alex,\nHello.', 'email')[0].text, before: [], after: [], verify: result => assert.notEqual(result.status, 'incomplete') }
  ];
  const started = Date.now(); console.log(`${suite} quality check: ${profile.model}, unchanged timeout ${profile.timeoutMs} ms.`);
  for (const [index, item] of cases.entries()) {
    if (process.env.TWA_REVIEW_CASE && Number(process.env.TWA_REVIEW_CASE) !== index + 1) continue;
    const offset = payloads.length;
    const request = { request_id: crypto.randomUUID(), document_id: crypto.randomUUID(), sentence_id: `${suite}-${index}`, revision_id: index,
      original_text: item.text, from: 0, to: item.text.length, mode: 'email', scope: 'sentence', profile_id: profile.id, context: { before: item.before, after: item.after, task: '' } };
    const result = await provider.analyze(request, new AbortController().signal);
    for (const body of payloads.slice(offset)) assert.deepEqual(JSON.parse(body.messages[1].content).context, request.context);
    console.log(JSON.stringify({ case: index + 1, httpRequests: payloads.length - offset, context: request.context, result }));
    item.verify(result);
  }
  console.log(`PASS: ${process.env.TWA_REVIEW_CASE ? 'selected example' : `${cases.length} fixed examples`}; actual payload context verified; elapsed ${Date.now() - started} ms.`);
} finally {
  try { if (provider) await provider.release(); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
