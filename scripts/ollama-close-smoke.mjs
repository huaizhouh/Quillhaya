// Opt-in real Electron + Ollama shutdown check. No user drafts or credentials.
import { _electron as electron } from '@playwright/test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settings = JSON.parse(await readFile(process.env.TWA_OLLAMA_SETTINGS ?? join(homedir(), 'Library/Application Support/TOEFL Writing Assistant/settings.json'), 'utf8'));
const profile = settings.profiles.find(p => p.id === (process.env.TWA_OLLAMA_PROFILE ?? settings.defaultProfileId));
assert(profile?.kind === 'ollama' && profile.auth === 'none', 'A local unauthenticated Ollama profile is required.');
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(profile.baseUrl).hostname), 'Only loopback Ollama endpoints are allowed.');
const base = profile.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
const resident = async model => {
  const response = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(5000) }); assert(response.ok);
  const body = await response.json();
  return body.models.some(item => [item.name, item.model].some(name => name === model || name === `${model}:latest`));
};
assert.equal(await resident(profile.model), false, 'Selected model is already in use; finish that session before this opt-in shutdown check.');
const directory = await mkdtemp(join(tmpdir(), 'twa-ollama-close-'));
let app, closed = false;
try {
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ ...settings, profiles: [profile], defaultProfileId: profile.id, autoAnalyze: false }));
  const env = { ...process.env, TWA_TEST_USER_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [join(root, 'out/main/main.js')], env });
  const page = await app.firstWindow(); await page.getByTestId('writing-editor').waitFor();
  // Optional historical ID: require it to be absent, then exercise the real IPC fallback.
  if (process.env.TWA_OLLAMA_OLD_MODEL) {
    const oldModel = process.env.TWA_OLLAMA_OLD_MODEL;
    assert.equal(await resident(oldModel), false);
    const result = await page.evaluate(({ profile, oldModel }) => window.desktop.stopModels({ ...profile, model: oldModel }), { profile, oldModel });
    assert(result.ok); assert.deepEqual(result.value.failed, []); assert(result.value.alreadyReleased.includes(oldModel));
    console.log(`PASS: historical ID ${oldModel} is confirmed absent without a false release error.`);
  }
  console.log(`Checking native quit after fixed-sentence analysis: ${profile.model}; original timeout ${profile.timeoutMs} ms.`);
  const started = Date.now();
  const reply = await page.evaluate(profileId => {
    const text = 'Learning takes practice.';
    return window.desktop.analyze({ request_id: crypto.randomUUID(), document_id: crypto.randomUUID(), sentence_id: 'shutdown-smoke', revision_id: 1,
      original_text: text, from: 0, to: text.length, mode: 'general', scope: 'sentence', profile_id: profileId, context: { before: [], after: [], task: '' } });
  }, profile.id);
  assert(reply.ok, reply.ok ? '' : reply.error.message); assert.equal(await resident(profile.model), true);
  console.log('PASS: fixed-sentence analysis completed and /api/ps confirms the model is resident.');
  const exit = app.waitForEvent('close', { timeout: 30_000 });
  await app.evaluate(({ app: main, dialog }) => {
    // Do not leave a smoke check waiting on a native cleanup-failure prompt.
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); main.quit();
  });
  await exit; closed = true;
  assert.equal(await resident(profile.model), false);
  console.log(`PASS: native quit unloaded ${profile.model}; /api/ps confirmed; elapsed ${Date.now() - started} ms.`);
} finally {
  if (app && !closed) await app.evaluate(({ app: main }) => main.exit(0)).catch(() => {});
  // A failed check must also attempt cleanup of its own test model.
  await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: profile.model, keep_alive: 0, stream: false }), signal: AbortSignal.timeout(10_000) }).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
