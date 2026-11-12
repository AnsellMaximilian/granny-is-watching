import assert from 'node:assert/strict';
import test from 'node:test';
import { GRANNY, PLAYER, ROWS, STORES, chooseGrannyPit, legalPits, newGame, playMove } from '../src/congklak.js';

function position(counts, turn = PLAYER) {
  return {
    pits: Object.assign(Array(16).fill(0), counts),
    turn,
    outcome: null,
  };
}

test('A5 from the five-seed opening sows toward the left store and grants a fresh choice', () => {
  const opening = newGame();
  assert.ok(ROWS.flat().every((pit) => opening.pits[pit] === 5));
  assert.deepEqual(STORES.map((pit) => opening.pits[pit]), [0, 0]);
  const { game, steps, bonus } = playMove(opening, 4);
  assert.deepEqual(steps.slice(1).map(({ pit }) => pit), [3, 2, 1, 0, 7]);
  assert.equal(bonus, true);
  assert.equal(game.turn, PLAYER);
  assert.deepEqual(game.pits.slice(0, 8), [6, 6, 6, 6, 0, 5, 5, 1]);
  assert.equal(opening.pits[4], 5);
});

test('relay continues with every seed in the occupied landing pit', () => {
  const { game, steps } = playMove(position({ 0: 3, 1: 4, 2: 2, 6: 1, 12: 3 }), 2);
  assert.deepEqual(steps.map(({ kind, pit }) => [kind, pit]), [
    ['lift', 2], ['drop', 1], ['drop', 0],
    ['lift', 0], ['drop', 7], ['drop', 8], ['drop', 9], ['drop', 10],
  ]);
  assert.equal(game.pits[10], 1);
  assert.equal(game.turn, GRANNY);
});

test('tembak transfers both the final seed and its directly opposite seeds', () => {
  const { game, captured, steps } = playMove(position({ 0: 2, 3: 1, 7: 9, 8: 3, 10: 5 }), 3);
  assert.equal(captured, 6);
  assert.deepEqual(steps.slice(-2), [
    { kind: 'capture', pit: 2, count: 6, emptied: [10] },
    { kind: 'bank', pit: 7, count: 15, emptied: [2] },
  ]);
  assert.equal(game.pits[7], 15);
  assert.equal(game.pits[2], 0);
  assert.equal(game.pits[10], 0);
});

test('Granny collects across the board and banks the pile on her side', () => {
  const { game, steps } = playMove(position({ 0: 2, 4: 3, 11: 1, 14: 2, 15: 6 }, GRANNY), 11);
  assert.deepEqual(steps.slice(-2), [
    { kind: 'capture', pit: 12, count: 4, emptied: [4] },
    { kind: 'bank', pit: 15, count: 10, emptied: [12] },
  ]);
  assert.equal(game.pits[STORES[GRANNY]], 10);
});

test('the opponent’s store is skipped from both directions', () => {
  const fromA = playMove(position({ 0: 8, 1: 1, 15: 23 }), 0);
  assert.deepEqual(fromA.steps.filter(({ kind }) => kind === 'drop').map(({ pit }) => pit), [7, 8, 9, 10, 11, 12, 13, 14]);
  const fromB = playMove(position({ 7: 23, 13: 1, 14: 9 }, GRANNY), 14);
  assert.deepEqual(fromB.steps.filter(({ kind }) => kind === 'drop').map(({ pit }) => pit), [15, 6, 5, 4, 3, 2, 1, 0, 8]);
});

test('an empty row takes precedence over a store bonus and the sweep can draw', () => {
  const { game } = playMove(position({ 0: 1, 7: 34, 8: 2, 15: 33 }), 0);
  assert.equal(game.outcome, 'draw');
  assert.deepEqual(STORES.map((pit) => game.pits[pit]), [35, 35]);
  assert.ok(ROWS.flat().every((pit) => game.pits[pit] === 0));
  assert.deepEqual(legalPits(game), []);
});

test('moves reject empty pits, stores, and Granny’s row', () => {
  const game = position({ 0: 2, 8: 4 });
  for (const pit of [1, 7, 8, 15, 16]) assert.throws(() => playMove(game, pit), RangeError);
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
        assert.equal(rendered.reduce((sum, count) => sum + count, step.hand ?? 0), 70);
      }
      assert.deepEqual(rendered, next.game.pits);
      game = next.game;
    }
    assert.equal(game.pits[7] + game.pits[15], 70);
    outcomes.add(game.outcome);
  }
  assert.ok(outcomes.has('win') && outcomes.has('loss'));
});
