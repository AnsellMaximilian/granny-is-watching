export const PLAYER = 0;
export const GRANNY = 1;
export const ROWS = [
  [0, 1, 2, 3, 4, 5, 6],
  [8, 9, 10, 11, 12, 13, 14],
];
export const STORES = [7, 15];

// Pits in each row are indexed from screen left to right, as in the rules guide.
const CLOCKWISE = [6, 5, 4, 3, 2, 1, 0, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export function newGame() {
  const pits = Array(16).fill(5);
  for (const store of STORES) pits[store] = 0;
  return { pits, turn: PLAYER, outcome: null };
}

export function legalPits({ pits, turn, outcome }) {
  return outcome ? [] : ROWS[turn].filter((pit) => pits[pit] > 0);
}

export function playMove(game, source) {
  if (!legalPits(game).includes(source)) throw new RangeError('Choose an occupied pit on your side.');

  const pits = [...game.pits];
  const steps = [];
  const side = game.turn;
  const opponent = 1 - side;
  const store = STORES[side];
  const path = CLOCKWISE.filter((pit) => pit !== STORES[opponent]);
  let cursor = path.indexOf(source);
  let landing = source;
  let bonus = false;
  let captured = 0;

  for (;;) {
    let hand = pits[landing];
    pits[landing] = 0;
    steps.push({ kind: 'lift', pit: landing, count: 0, hand });

    let previousCount;
    while (hand > 0) {
      cursor = (cursor + 1) % path.length;
      landing = path[cursor];
      previousCount = pits[landing];
      pits[landing] += 1;
      hand -= 1;
      steps.push({ kind: 'drop', pit: landing, count: pits[landing], hand });
    }

    if (landing === store) {
      bonus = true;
      break;
    }
    if (previousCount === 0) break;
  }

  const column = ROWS[side].indexOf(landing);
  if (!bonus && column !== -1) {
    const opposite = ROWS[opponent][column];
    if (pits[opposite] > 0) {
      captured = pits[opposite] + 1;
      steps.push({ kind: 'capture', pit: landing, count: captured, emptied: [opposite] });
      pits[landing] = 0;
      pits[opposite] = 0;
      pits[store] += captured;
      steps.push({ kind: 'bank', pit: store, count: pits[store], emptied: [landing] });
    }
  }

  let outcome = null;
  if (ROWS.some((row) => row.every((pit) => pits[pit] === 0))) {
    for (const [owner, row] of ROWS.entries()) {
      const remaining = row.reduce((total, pit) => total + pits[pit], 0);
      if (remaining === 0) continue;
      for (const pit of row) pits[pit] = 0;
      pits[STORES[owner]] += remaining;
      steps.push({ kind: 'sweep', pit: STORES[owner], count: pits[STORES[owner]], emptied: row });
    }
    const difference = pits[STORES[PLAYER]] - pits[STORES[GRANNY]];
    outcome = difference === 0 ? 'draw' : difference > 0 ? 'win' : 'loss';
  }

  return { game: { pits, turn: bonus ? side : opponent, outcome }, steps, bonus, captured };
}

export function chooseGrannyPit(game, random = Math.random) {
  const choices = legalPits(game).map((pit) => {
    const move = playMove(game, pit);
    const score = move.game.pits[STORES[GRANNY]] - move.game.pits[STORES[PLAYER]];
    return { pit, score: score + (move.bonus ? 3 : 0) + 8 * random() };
  });
  choices.sort((a, b) => b.score - a.score);
  return choices[0]?.pit;
}
