export const PLAYER = 0;
export const GRANNY = 1;
const SMALL_PITS_PER_SIDE = 6;
const PITS_PER_SIDE = SMALL_PITS_PER_SIDE + 1;
export const ROWS = [PLAYER, GRANNY].map((side) =>
  Array.from({ length: SMALL_PITS_PER_SIDE }, (_, column) => side * PITS_PER_SIDE + column),
);
export const STORES = ROWS.map((row) => row.at(-1) + 1);
// Read from the player's seat, with Granny's row above the player's row.
export const ESCAPE_PATTERN = [ROWS[GRANNY][1], ROWS[GRANNY][4], ROWS[PLAYER][0], ROWS[PLAYER][3]];

// Pits in each row are indexed from screen left to right, as in the rules guide.
const CLOCKWISE = [...ROWS[PLAYER].toReversed(), STORES[PLAYER], ...ROWS[GRANNY], STORES[GRANNY]];

export function newGame(burned = []) {
  const pits = Array(CLOCKWISE.length).fill(0);
  for (const pit of ROWS.flat()) {
    if (!burned.includes(pit)) pits[pit] = 4;
  }
  return { pits, burned: [...burned], turn: PLAYER, outcome: null };
}

export function legalPits({ pits, burned, turn, outcome }) {
  return outcome ? [] : ROWS[turn].filter((pit) => !burned.includes(pit) && pits[pit] > 0);
}

export function burnablePits({ burned, outcome }) {
  return outcome === 'win' ? ROWS.flat().filter((pit) => !burned.includes(pit)) : [];
}

export function burnPit(game, pit) {
  if (!burnablePits(game).includes(pit)) throw new RangeError('Choose an unburned small pit after winning.');
  const burned = [...game.burned, pit];
  let ending = null;
  if (burned.length === ESCAPE_PATTERN.length && ESCAPE_PATTERN.every((mark) => burned.includes(mark))) {
    ending = 'true';
  } else if (ROWS[GRANNY].every((smallPit) => burned.includes(smallPit))) {
    ending = 'false';
  } else if (ROWS[PLAYER].every((smallPit) => burned.includes(smallPit))) {
    ending = 'no-ground';
  }
  return { burned, ending };
}

export function playMove(game, source) {
  if (!legalPits(game).includes(source)) throw new RangeError('Choose an occupied pit on your side.');

  const pits = [...game.pits];
  const steps = [];
  const side = game.turn;
  const opponent = 1 - side;
  const store = STORES[side];
  const { burned } = game;
  const path = CLOCKWISE.filter((pit) => pit !== STORES[opponent] && !burned.includes(pit));
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
    if (!burned.includes(opposite) && pits[opposite] > 0) {
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

  return { game: { pits, burned, turn: bonus ? side : opponent, outcome }, steps, bonus, captured };
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
