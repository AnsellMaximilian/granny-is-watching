import assert from 'node:assert/strict';
import test from 'node:test';
import { GRANNY, PLAYER, ROWS, STORES, burnablePits, burnPit, chooseGrannyPit, legalPits, newGame, playMove } from '../src/congklak.js';

const [A1, A2, A3, A4, A5, A6] = ROWS[PLAYER];
const [B1, B2, B3, B4, B5, B6] = ROWS[GRANNY];
const [A_STORE, B_STORE] = STORES;

function position(counts, turn = PLAYER, burned = []) {
  const game = newGame(burned);
  return {
    ...game,
    pits: Object.assign(game.pits.fill(0), counts),
    turn,
  };
}

test('A4 from the four-seed opening sows toward the left store and grants a fresh choice', () => {
  const opening = newGame();
  assert.deepEqual(ROWS.map((row) => row.length), [6, 6]);
  assert.equal(opening.pits.length, 14);
  assert.ok(ROWS.flat().every((pit) => opening.pits[pit] === 4));
  assert.deepEqual(STORES.map((pit) => opening.pits[pit]), [0, 0]);
  const { game, steps, bonus } = playMove(opening, A4);
  assert.deepEqual(steps.slice(1).map(({ pit }) => pit), [A3, A2, A1, A_STORE]);
  assert.equal(bonus, true);
  assert.equal(game.turn, PLAYER);
  assert.deepEqual(game.pits.slice(0, A_STORE + 1), [5, 5, 5, 0, 4, 4, 1]);
  assert.equal(opening.pits[A4], 4);
});

test('relay continues with every seed in the occupied landing pit', () => {
  const { game, steps } = playMove(position({ [A1]: 3, [A2]: 4, [A3]: 2, [A6]: 1, [B5]: 3 }), A3);
  assert.deepEqual(steps.map(({ kind, pit }) => [kind, pit]), [
    ['lift', A3], ['drop', A2], ['drop', A1],
    ['lift', A1], ['drop', A_STORE], ['drop', B1], ['drop', B2], ['drop', B3],
  ]);
  assert.equal(game.pits[B3], 1);
  assert.equal(game.turn, GRANNY);
});

test('tembak transfers both the final seed and its directly opposite seeds', () => {
  const { game, captured, steps } = playMove(position({ [A1]: 2, [A4]: 1, [A_STORE]: 9, [B1]: 3, [B3]: 5 }), A4);
  assert.equal(captured, 6);
  assert.deepEqual(steps.slice(-2), [
    { kind: 'capture', pit: A3, count: 6, emptied: [B3] },
    { kind: 'bank', pit: A_STORE, count: 15, emptied: [A3] },
  ]);
  assert.equal(game.pits[A_STORE], 15);
  assert.equal(game.pits[A3], 0);
  assert.equal(game.pits[B3], 0);
});

test('Granny collects across the board and banks the pile on her side', () => {
  const { game, steps } = playMove(position({ [A1]: 2, [A6]: 3, [B4]: 2, [B5]: 1, [B_STORE]: 6 }, GRANNY), B5);
  assert.deepEqual(steps.slice(-2), [
    { kind: 'capture', pit: B6, count: 4, emptied: [A6] },
    { kind: 'bank', pit: B_STORE, count: 10, emptied: [B6] },
  ]);
  assert.equal(game.pits[B_STORE], 10);
});

test('the opponent’s store is skipped from both directions', () => {
  const fromA = playMove(position({ [A1]: 8, [A2]: 1, [B_STORE]: 23 }), A1);
  assert.deepEqual(fromA.steps.filter(({ kind }) => kind === 'drop').map(({ pit }) => pit),
    [A_STORE, B1, B2, B3, B4, B5, B6, A6]);
  const fromB = playMove(position({ [A_STORE]: 23, [B5]: 1, [B6]: 8 }, GRANNY), B6);
  assert.deepEqual(fromB.steps.filter(({ kind }) => kind === 'drop').map(({ pit }) => pit),
    [B_STORE, A6, A5, A4, A3, A2, A1, B1]);
});

test('an empty row takes precedence over a store bonus and the sweep can draw', () => {
  const { game } = playMove(position({ [A1]: 1, [A_STORE]: 23, [B1]: 2, [B_STORE]: 22 }), A1);
  assert.equal(game.outcome, 'draw');
  assert.deepEqual(STORES.map((pit) => game.pits[pit]), [24, 24]);
  assert.ok(ROWS.flat().every((pit) => game.pits[pit] === 0));
  assert.deepEqual(legalPits(game), []);
});

test('moves reject empty pits, stores, and Granny’s row', () => {
  const game = position({ [A1]: 2, [B1]: 4 });
  for (const pit of [A2, A_STORE, B1, B_STORE, game.pits.length]) assert.throws(() => playMove(game, pit), RangeError);
});

test('a win lets the player burn one open pit on either side for the next round', () => {
  const game = { ...newGame([A2]), outcome: 'win' };
  assert.ok(burnablePits(game).includes(A3));
  assert.ok(burnablePits(game).includes(B4));
  for (const pit of [A2, A_STORE, B_STORE]) assert.throws(() => burnPit(game, pit), RangeError);
  for (const outcome of [null, 'draw', 'loss']) {
    assert.throws(() => burnPit({ ...game, outcome }, B4), RangeError);
  }
  const { burned, complete } = burnPit(game, B4);
  assert.equal(complete, false);
  assert.deepEqual(game.burned, [A2]);
  const next = newGame(burned);
  assert.deepEqual(next.burned, [A2, B4]);
  assert.equal(next.turn, PLAYER);
  assert.equal(next.pits.reduce((sum, count) => sum + count, 0), 40);
  assert.equal(next.pits[A2], 0);
  assert.equal(next.pits[B4], 0);
  assert.ok(!legalPits(next).includes(A2));
  assert.ok(!legalPits({ ...next, turn: GRANNY }).includes(B4));
});

test('both sowing paths skip burned pits and a burned opposite pit cannot be captured', () => {
  const burned = [A6, B1];
  const fromA = playMove(position({ [A1]: 3, [A2]: 1, [B5]: 2 }, PLAYER, burned), A1);
  assert.deepEqual(fromA.steps.filter(({ kind }) => kind === 'drop').map(({ pit }) => pit),
    [A_STORE, B2, B3]);
  const fromB = playMove(position({ [A1]: 1, [B2]: 1, [B6]: 3 }, GRANNY, burned), B6);
  assert.deepEqual(fromB.steps.filter(({ kind }) => kind === 'drop').map(({ pit }) => pit),
    [B_STORE, A5, A4]);
  const final = playMove(position({ [A1]: 2, [A4]: 1, [B4]: 3 }, PLAYER, [B3]), A4);
  assert.equal(final.captured, 0);
  assert.equal(final.game.pits[A3], 1);
  assert.equal(final.game.pits[B3], 0);
});

test('burning the last playable pit on a side completes the run', () => {
  const game = { ...newGame(ROWS[GRANNY].slice(0, -1)), outcome: 'win' };
  assert.equal(burnPit(game, B6).complete, true);
});

test('full rounds preserve all seeds in every animation step and reach both outcomes', () => {
  let seed = 52;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const outcomes = new Set();
  for (let i = 0; i < 120; i++) {
    const burned = i % 2 === 0 ? [] : [A3, B1, B6];
    const total = 48 - burned.length * 4;
    let game = newGame(burned);
    let moves = 0;
    while (!game.outcome) {
      assert.ok(moves++ < 500, 'the round must finish');
      const options = legalPits(game);
      const pit = game.turn === GRANNY ? chooseGrannyPit(game, random) : options[Math.floor(random() * options.length)];
      const next = playMove(game, pit);
      const rendered = [...game.pits];
      for (const step of next.steps) {
        step.emptied?.forEach((empty) => { rendered[empty] = 0; });
        rendered[step.pit] = step.count;
        assert.equal(rendered.reduce((sum, count) => sum + count, step.hand ?? 0), total);
        assert.ok(burned.every((pit) => rendered[pit] === 0));
      }
      assert.deepEqual(rendered, next.game.pits);
      game = next.game;
    }
    assert.equal(game.pits[A_STORE] + game.pits[B_STORE], total);
    outcomes.add(game.outcome);
  }
  assert.ok(outcomes.has('win') && outcomes.has('loss'));
});
