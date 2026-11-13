export const PLAYER = 0;
export const GRANNY = 1;
const SMALL_PITS_PER_SIDE = 6;
const PITS_PER_SIDE = SMALL_PITS_PER_SIDE + 1;
export const ROWS = [PLAYER, GRANNY].map((side) =>
  Array.from({ length: SMALL_PITS_PER_SIDE }, (_, column) => side * PITS_PER_SIDE + column),
);
export const STORES = ROWS.map((row) => row.at(-1) + 1);

// Pits in each row are indexed from screen left to right, as in the rules guide.
const CLOCKWISE = [...ROWS[PLAYER].toReversed(), STORES[PLAYER], ...ROWS[GRANNY], STORES[GRANNY]];

function drawEscapePattern() {
  return [GRANNY, PLAYER].flatMap((side) => {
    const candidates = [...ROWS[side]];
    const [first] = candidates.splice(Math.floor(Math.random() * candidates.length), 1);
    return [first, candidates[Math.floor(Math.random() * candidates.length)]];
  });
}

export function newGame(burned = [], escapePattern = drawEscapePattern()) {
  const pits = Array(CLOCKWISE.length).fill(0);
  for (const pit of ROWS.flat()) {
    if (!burned.includes(pit)) pits[pit] = 4;
  }
  return { pits, burned: [...burned], escapePattern: [...escapePattern], turn: PLAYER, outcome: null };
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
  const { escapePattern } = game;
  let ending = null;
  if (burned.length === escapePattern.length && escapePattern.every((mark) => burned.includes(mark))) {
    ending = 'true';
  } else if (ROWS[GRANNY].every((smallPit) => burned.includes(smallPit))) {
    ending = 'false';
  } else if (ROWS[PLAYER].every((smallPit) => burned.includes(smallPit))) {
    ending = 'no-ground';
  }
  return { burned, ending };
}

function finishEmptyRows(pits, steps) {
  if (!ROWS.some((row) => row.every((pit) => pits[pit] === 0))) return null;
  for (const [owner, row] of ROWS.entries()) {
    const remaining = row.reduce((total, pit) => total + pits[pit], 0);
    if (remaining === 0) continue;
    for (const pit of row) pits[pit] = 0;
    pits[STORES[owner]] += remaining;
    steps.push({ kind: 'sweep', pit: STORES[owner], count: pits[STORES[owner]], emptied: row });
  }
  const difference = pits[STORES[PLAYER]] - pits[STORES[GRANNY]];
  return difference === 0 ? 'draw' : difference > 0 ? 'win' : 'loss';
}

export function stealPlayerPit(game, random = Math.random) {
  if (game.turn !== PLAYER || game.outcome) throw new RangeError('Granny can steal only while the player is choosing.');
  const choices = legalPits(game);
  if (choices.length === 0) throw new RangeError('There is no occupied player pit to steal.');
  const source = choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
  const pits = [...game.pits];
  const seeds = pits[source];
  pits[source] = 0;
  pits[STORES[GRANNY]] += seeds;
  const steps = [{ kind: 'steal', pit: STORES[GRANNY], count: pits[STORES[GRANNY]], emptied: [source] }];
  const outcome = finishEmptyRows(pits, steps);
  return { game: { ...game, pits, outcome }, source, seeds, steps };
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

  const outcome = finishEmptyRows(pits, steps);

  return { game: { ...game, pits, turn: bonus ? side : opponent, outcome }, steps, bonus, captured };
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
