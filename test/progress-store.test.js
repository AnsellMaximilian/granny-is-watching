import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, ProgressStore, decodeProgress, validCheckpoint } from '../src/progress-store.js';
import { newGame } from '../src/congklak.js';

const checkpoint = { burned: [1, 8], escapePattern: [0, 2, 7, 9] };
function memory(initial = null) {
  let value = initial;
  return { read: async () => value, write: async (json) => { value = json; }, get value() { return value; } };
}

test('local saves preserve round setup and clue across reloads without retaining partial moves or credentials', async () => {
  const storage = memory();
  const progress = await ProgressStore.load(storage);
  assert.deepEqual(progress.settings, DEFAULT_SETTINGS);
  await progress.saveRound({ ...checkpoint, pits: [99], turn: 1, outcome: 'loss', apiKey: 'private-test-key' });
  const loaded = await ProgressStore.load(storage);
  assert.deepEqual(loaded.getCheckpoint(), checkpoint);
  const round = newGame(loaded.getCheckpoint().burned, loaded.getCheckpoint().escapePattern);
  assert.equal(round.pits.reduce((total, count) => total + count), 40);
  assert.equal(round.pits[1], 0);
  assert.equal(round.pits[8], 0);
  assert.equal(round.turn, 0);
  assert.equal(round.outcome, null);
  assert.ok(!storage.value.includes('private-test-key'));
  assert.ok(!storage.value.includes('"pits"'));
  loaded.getCheckpoint().burned.push(3);
  assert.deepEqual(loaded.getCheckpoint(), checkpoint);
});

test('saving off removes the checkpoint and persists difficulty and other preferences', async () => {
  const storage = memory();
  const progress = await ProgressStore.load(storage);
  await progress.saveRound(checkpoint);
  await progress.updateSettings({ saveProgress: false, sound: false, facialHurdles: true, showCamera: false, apiKey: 'ignored' });
  await progress.saveRound(checkpoint);
  const loaded = await ProgressStore.load(storage);
  assert.equal(loaded.getCheckpoint(), null);
  assert.deepEqual(loaded.settings, { saveProgress: false, sound: false, facialHurdles: true, showCamera: false });
  assert.ok(!storage.value.includes('ignored'));
  await loaded.updateSettings({ saveProgress: true });
  assert.equal(loaded.getCheckpoint(), null, 'Re-enabling saving does not resurrect an erased run');
});

test('corrupt, unsupported and impossible saves cannot create an unwinnable continuation', async () => {
  for (const json of ['{broken', '{"version":99,"settings":{}}', JSON.stringify({ version: 1, settings: {}, checkpoint: { ...checkpoint, burned: [6] } })]) {
    const storage = memory(json);
    const loaded = await ProgressStore.load(storage);
    assert.equal(loaded.getCheckpoint(), null);
    assert.ok(loaded.issue);
    assert.equal(storage.value, json, 'Loading does not overwrite an unreadable save');
  }
  for (const value of [
    { ...checkpoint, burned: [1, 1] },
    { ...checkpoint, burned: [0, 1, 2, 3, 4, 5] },
    { ...checkpoint, burned: [7, 8, 9, 10, 11, 12] },
    { ...checkpoint, burned: [0, 2, 7, 9] },
    { ...checkpoint, escapePattern: [0, 1, 2, 7] },
    { ...checkpoint, escapePattern: [0, 0, 7, 9] },
    { ...checkpoint, burned: ['1'] },
  ]) assert.equal(validCheckpoint(value), null);
  assert.throws(() => decodeProgress('{"version":1,"settings":null}'));
});

test('storage failures retain an in-session checkpoint and report persistence failure without crashing', async () => {
  const progress = await ProgressStore.load({ read: async () => { throw new Error('Denied'); }, write: async () => { throw new Error('Full'); } });
  assert.ok(progress.issue);
  await progress.saveRound(checkpoint);
  assert.deepEqual(progress.getCheckpoint(), checkpoint);
  assert.match(progress.issue, /session/);
  await progress.clearCheckpoint();
  assert.equal(progress.getCheckpoint(), null);
});

test('an invalid checkpoint keeps valid sound and difficulty preferences', async () => {
  const storage = memory(JSON.stringify({ version: 1, settings: { sound: false, facialHurdles: false, saveProgress: true }, checkpoint: { ...checkpoint, burned: [6] } }));
  const loaded = await ProgressStore.load(storage);
  assert.equal(loaded.getCheckpoint(), null);
  assert.equal(loaded.settings.sound, false);
  assert.match(loaded.issue, /settings were kept/);
});

test('queued updates persist the newest checkpoint and clearing it keeps preferences', async () => {
  const storage = memory();
  const progress = await ProgressStore.load(storage);
  const first = progress.saveRound(checkpoint);
  const second = progress.saveRound({ ...checkpoint, burned: [1, 8, 3] });
  await Promise.all([first, second]);
  assert.deepEqual((await ProgressStore.load(storage)).getCheckpoint().burned, [1, 8, 3]);
  await progress.updateSettings({ sound: false });
  await progress.clearCheckpoint();
  const loaded = await ProgressStore.load(storage);
  assert.equal(loaded.getCheckpoint(), null);
  assert.equal(loaded.settings.sound, false);
});
