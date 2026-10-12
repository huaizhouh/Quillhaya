// Opt-in lifecycle check: fixed text, current local Ollama profile, no user drafts.
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settings = JSON.parse(await readFile(process.env.TWA_OLLAMA_SETTINGS ?? join(homedir(), 'Library/Application Support/TOEFL Writing Assistant/settings.json'), 'utf8'));
const profile = settings.profiles.find(p => p.id === (process.env.TWA_OLLAMA_PROFILE ?? settings.defaultProfileId));
assert(profile?.kind === 'ollama' && profile.auth === 'none', 'A local unauthenticated Ollama profile is required.');
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.baseUrl).hostname), 'Only loopback Ollama endpoints are allowed.');
const directory = await mkdtemp(join(tmpdir(), 'twa-lifecycle-'));
let provider;
try {
  const bundle = await build({ stdin: { contents: "export * from './electron/llm/provider'; export * from './electron/llm/queue'; export * from './electron/llm/runtime';", resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const modulePath = join(directory, 'runtime.mjs'); await writeFile(modulePath, bundle.outputFiles[0].text);
  const { CompatibleProvider, connectionRequest, RequestQueue, ModelRuntime } = await import(pathToFileURL(modulePath).href);
  const runtime = new ModelRuntime(new RequestQueue()); provider = new CompatibleProvider(profile);
  const resident = async () => {
    const res = await fetch(`${profile.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/api/ps`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok); const body = await res.json();
    return body.models.some(m => [profile.model, `${profile.model}:latest`].includes(m.name ?? m.model));
  };
  const started = Date.now();
  console.log(`Lifecycle test: ${profile.model}; original timeout ${profile.timeoutMs} ms.`);
  const result = await runtime.test(crypto.randomUUID(), profile, signal => provider.testConnection(signal), () => provider.release());
  assert(result.includes('已从 Ollama 内存中释放')); assert.equal(await resident(), false);
  console.log('PASS: selected-profile connection test completed; /api/ps confirms test model unloaded.');
  runtime.track(profile, () => provider.release());
  await provider.analyze(connectionRequest(profile.id), new AbortController().signal);
  assert.equal(await resident(), true);
  const stopped = await runtime.stop(); assert.deepEqual(stopped.failed, []); assert.deepEqual(stopped.released, [profile.model]);
  assert.equal(await resident(), false);
  console.log(`PASS: explicit stop released resident model; /api/ps confirmed; elapsed ${Date.now() - started} ms.`);
} finally {
  // Also clean up a timed-out or failed check rather than leave its model resident.
  if (provider) await provider.release().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
