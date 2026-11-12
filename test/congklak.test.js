import assert from 'node:assert/strict';
import test from 'node:test';
import { GRANNY, PLAYER, ROWS, STORES, chooseGrannyPit, legalPits, newGame, playMove } from '../src/congklak.js';

const [A1, A2, A3, A4, A5, A6] = ROWS[PLAYER];
const [B1, B2, B3, B4, B5, B6] = ROWS[GRANNY];
const [A_STORE, B_STORE] = STORES;

function position(counts, turn = PLAYER) {
  return {
    pits: Object.assign(newGame().pits.fill(0), counts),
    turn,
    outcome: null,
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

test('full rounds preserve all seeds in every animation step and reach both outcomes', () => {
  let seed = 52;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const outcomes = new Set();
  for (let i = 0; i < 120; i++) {
    let game = newGame();
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
        assert.equal(rendered.reduce((sum, count) => sum + count, step.hand ?? 0), 48);
      }
      assert.deepEqual(rendered, next.game.pits);
      game = next.game;
    }
    assert.equal(game.pits[A_STORE] + game.pits[B_STORE], 48);
    outcomes.add(game.outcome);
  }
  assert.ok(outcomes.has('win') && outcomes.has('loss'));
});
