import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, unlink, rmdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { registerProgressIpc } = createRequire(import.meta.url)('../electron/progress.cjs');

async function fixture(t, blocked = false) {
  const folder = await mkdtemp(path.join(tmpdir(), 'granny-progress-'));
  const dataDir = blocked ? path.join(folder, 'blocked') : folder;
  if (blocked) await writeFile(dataDir, 'not a directory');
  t.after(async () => {
    for (const name of ['progress.json', 'progress.json.tmp', 'blocked']) await unlink(path.join(folder, name)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(folder);
  });
  const handlers = new Map();
  registerProgressIpc({ app: { getPath: () => dataDir }, ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, isTrusted: (event) => event.trusted === true });
  return { folder, read: () => handlers.get('granny:load-progress')({ trusted: true }), write: (json, trusted = true) => handlers.get('granny:save-progress')({ trusted }, json) };
}

test('desktop progress survives reloads and serializes overlapping writes into one complete file', async (t) => {
  const store = await fixture(t);
  assert.deepEqual(await store.read(), { data: null });
  const first = JSON.stringify({ version: 1, settings: { sound: true }, checkpoint: null });
  const second = JSON.stringify({ version: 1, settings: { sound: false }, checkpoint: null });
  assert.deepEqual(await Promise.all([store.write(first), store.write(second)]), [{ ok: true }, { ok: true }]);
  assert.deepEqual(await store.read(), { data: second });
  assert.equal(await readFile(path.join(store.folder, 'progress.json'), 'utf8'), second);
  await assert.rejects(access(path.join(store.folder, 'progress.json.tmp')));
});

test('desktop progress rejects untrusted or oversized writes before touching the save', async (t) => {
  const store = await fixture(t);
  await assert.rejects(store.write('{}', false));
  await assert.rejects(store.write('x'.repeat(9000)));
  await assert.rejects(store.write('{bad'));
  await assert.rejects(store.write('{"version":1,"settings":null}'));
  assert.deepEqual(await store.read(), { data: null });
});

test('desktop storage errors return recoverable results', async (t) => {
  const store = await fixture(t, true);
  assert.deepEqual(await store.write('{"version":1,"settings":{},"checkpoint":null}'), { ok: false });
  assert.equal((await store.read()).data, null);
});

test('oversized files are rejected when loading progress', async (t) => {
  const store = await fixture(t);
  await writeFile(path.join(store.folder, 'progress.json'), 'x'.repeat(9000));
  assert.equal((await store.read()).error, true);
});
