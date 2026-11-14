import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { registerSpectraDiagnosticsIpc, sanitizeRecord } = createRequire(import.meta.url)('../electron/spectra-diagnostics.cjs');

async function fixture(t, options = {}) {
  const folder = await mkdtemp(path.join(tmpdir(), 'granny-diagnostics-'));
  const file = path.join(folder, 'timing.jsonl');
  t.after(async () => { await rm(file, { force: true }); await rm(file + '.previous', { force: true }); await rmdir(folder); });
  const handlers = new Map();
  const logger = registerSpectraDiagnosticsIpc({ file, ipcMain: { on: (channel, handler) => handlers.set(channel, handler) },
    isTrusted: event => event.trusted === true, ...options });
  return { logger, file, send: (record, trusted = true) => handlers.get('granny:spectra-diagnostic')({ trusted }, record) };
}

test('diagnostic IPC writes complete ordered JSON lines and excludes private payloads', async t => {
  const { logger, file, send } = await fixture(t);
  send({ event: 'sdk_error', code: 14, retryable: true, sessionElapsedMs: 5100,
    apiKey: 'private-secret', message: 'private native message', face: ['private landmarks'], frame: new Uint8Array([1, 2, 3]) });
  send({ event: 'timing_sample', timestampFps: 18.5, callbackFps: 17.8, gamePhase: 'facial-happy' });
  send({ event: 'sdk_error', code: 2 }, false);
  await logger.flush();
  const text = await readFile(file, 'utf8');
  const records = text.trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(record => record.event), ['logger_start', 'sdk_error', 'timing_sample']);
  assert.equal(records[1].code, 14);
  assert.equal(records[1].retryable, true);
  assert.equal(records[1].sessionElapsedMs, 5100);
  assert.equal(records[0].runId, records[2].runId);
  assert.ok(!text.includes('private'));
  assert.ok(!text.includes('frame'));
});

test('invalid records are dropped and rotation retains only the previous log', async t => {
  const { logger, file, send } = await fixture(t, { maxBytes: 360 });
  for (let index = 0; index < 10; index++) send({ event: 'timing_sample', framesReceived: index, callbackFps: 29.9 });
  send({ event: 'not-an-event', apiKey: 'never persisted' });
  await logger.flush();
  for (const name of [file, file + '.previous']) {
    const text = await readFile(name, 'utf8');
    assert.ok(Buffer.byteLength(text) <= 360);
    assert.ok(!text.includes('never persisted'));
    for (const line of text.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
  }
  assert.equal(sanitizeRecord({ event: 'sdk_error', code: 'private-secret', timestampFps: NaN }).code, null);
});

test('log write failures resolve silently instead of breaking the app', async t => {
  const { logger, file } = await fixture(t);
  await logger.flush();
  await rm(file);
  await writeFile(file, 'not JSON');
  const handlers = new Map();
  const broken = registerSpectraDiagnosticsIpc({ file: path.join(file, 'child.jsonl'),
    ipcMain: { on: (channel, handler) => handlers.set(channel, handler) }, isTrusted: () => true });
  assert.doesNotThrow(() => handlers.get('granny:spectra-diagnostic')({}, { event: 'sdk_error', code: 14 }));
  await assert.doesNotReject(broken.flush());
});
