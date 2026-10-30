// Explicit, opt-in integration check using synthetic text only. Does not change
// settings, read credentials/drafts, download models, or start an Ollama server.
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = process.env.QUILLHAYA_OLLAMA_SETTINGS ?? join(homedir(), 'Library/Application Support/Quillhaya/settings.json');
const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
const profile = settings.profiles.find(p => p.id === settings.defaultProfileId);
assert(profile?.kind === 'ollama' && profile.auth === 'none', 'Select an unauthenticated local Ollama profile first.');
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.baseUrl).hostname), 'This smoke check only sends to a loopback Ollama endpoint.');
const directory = await mkdtemp(join(tmpdir(), 'twa-ollama-check-'));
let provider;
try {
  const bundle = await build({ stdin: { contents: "export * from './electron/llm/provider'; export * from './electron/llm/queue';", resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const modulePath = join(directory, 'provider.mjs'); await writeFile(modulePath, bundle.outputFiles[0].text);
  const { CompatibleProvider, connectionRequest, RequestQueue, serialKey } = await import(pathToFileURL(modulePath).href);
  const queue = new RequestQueue(); const started = Date.now(); let calls = 0; let active = 0; let peak = 0;
  provider = new CompatibleProvider(profile, undefined, async (...args) => { calls++; return fetch(...args); });
  const cases = [
    { text: 'Learning takes practice.', status: 'good' },
    { text: 'He go to school every day.', status: 'needs_revision' },
    { text: 'I think online courses are quite efficiency and convenience.', status: 'needs_revision' },
    { text: 'Students can review difficult material whenever they need to.', status: 'good' }
  ];
  console.log(`Ollama integration: ${profile.model}; per-attempt timeout ${profile.timeoutMs} ms; ${cases.length} synthetic sentences queued together.`);
  const tasks = cases.map((item, index) => {
    const request = { ...connectionRequest(profile.id), sentence_id: `live-${index + 1}`, original_text: item.text, to: item.text.length };
    const enqueued = Date.now();
    return queue.add(request.request_id, async signal => {
      const start = Date.now(), beforeCalls = calls; active++; peak = Math.max(peak, active);
      try {
        const result = await provider.analyze(request, signal);
        assert.equal(result.status, item.status); assert.equal(result.original_text, item.text);
        assert.match(result.overall_explanation_zh, /[\u3400-\u9fff]/u);
        if (item.status === 'needs_revision') assert(result.suggested_revision && result.issues.length);
        console.log(JSON.stringify({ case: index + 1, status: result.status, queuedMs: start - enqueued, inferenceMs: Date.now() - start, httpAttempts: calls - beforeCalls }));
      } finally { active--; }
    }, serialKey(profile));
  });
  const results = await Promise.allSettled(tasks); queue.clear();
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  assert.equal(peak, 1);
  console.log(`PASS: ${cases.length} real model reviews; peak concurrency ${peak}; HTTP attempts ${calls}; elapsed ${Date.now() - started} ms.`);
} finally {
  try { if (provider) await provider.release(); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
