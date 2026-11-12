import './style.css';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LoadAssetContainerAsync, RegisterSceneLoaderPlugin } from '@babylonjs/core/Loading/sceneLoader';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { GLTFFileLoader } from '@babylonjs/loaders/glTF/2.0/glTFLoader';

import { buildRoom } from './room.js';
import { BOARD_TOP, PITS, buildBoard } from './board.js';
import { PLAYER, GRANNY, ROWS, STORES, chooseGrannyPit, legalPits, newGame, playMove } from './congklak.js';

const $ = (id) => document.getElementById(id);
const wake = $('wake');
const sit = $('sit');
const again = $('again');
const match = $('match');
const canvas = $('scene');
const handCount = $('hand-count');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const modelUrl = import.meta.env.BASE_URL + 'models/granny.glb';

const DEFAULT_FOV = 0.71;
const WAITING_POSE = { position: [-2.99, 0.23, 1.88], target: [-0.39, 0.97, -3.05], roll: -0.22 };
const WAKE_POSES = [
  [0, [-2.99, 0.18, 1.87], [-0.76, 2.64, -2.84], -0.53],
  [0.82, [-2.95, 0.24, 1.88], [-0.47, 0.91, -3.10], -0.25],
  [2.02, [-2.68, 1.35, 1.98], [-0.35, 0.99, -2.68], 0.035],
  [3.12, [-1.64, 1.67, 2.10], [-0.17, 1.05, -1.83], 0],
  [4.23, [0.31, 1.65, 1.91], [-0.16, 1.00, -1.25], 0],
  [6.25, [0.31, 1.65, 1.91], [-0.16, 1.00, -1.25], 0],
];
const SEATED_POSE = { position: [-0.60, 1.21, 1.34], target: [-0.03, 0.93, -1.22], roll: 0 };
const INVITATION_TIME = WAKE_POSES.at(-1)[0];
const SIT_DURATION = 1.05;
const OVERHEAD_START = SIT_DURATION + 0.35;
const OVERHEAD_DURATION = 1.05;
const ease = (t) => t * t * (3 - 2 * t);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function blendPose(start, end, amount) {
  const mix = (a, b) => a + (b - a) * amount;
  return {
    position: start.position.map((value, i) => mix(value, end.position[i])),
    target: start.target.map((value, i) => mix(value, end.target[i])),
    roll: mix(start.roll, end.roll),
    fov: mix(start.fov ?? DEFAULT_FOV, end.fov ?? DEFAULT_FOV),
  };
}

function wakePose(time) {
  const index = WAKE_POSES.findIndex(([end]) => time < end);
  const pose = ([, position, target, roll]) => ({ position, target, roll });
  if (index < 0) return pose(WAKE_POSES.at(-1));
  const start = WAKE_POSES[index - 1];
  const end = WAKE_POSES[index];
  return blendPose(pose(start), pose(end), ease((time - start[0]) / (end[0] - start[0])));
}

async function launch() {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.048, 0.035, 0.039, 1);
  scene.skipPointerMovePicking = true;
  const camera = new FreeCamera('First-person camera', Vector3.Zero(), scene);
  camera.minZ = 0.045;
  camera.maxZ = 22;
  const room = buildRoom(scene);
  const glow = new GlowLayer('Candle bloom', scene, { mainTextureFixedSize: 256, blurKernelSize: 42 });
  glow.intensity = 0.48;
  for (const flame of room.flames) glow.addIncludedOnlyMesh(flame);
  let game = newGame();
  const board = buildBoard(scene, game.pits, reducedMotion);

  RegisterSceneLoaderPlugin(new GLTFFileLoader());
  const granny = await LoadAssetContainerAsync(modelUrl, scene);
  granny.addAllToScene();
  for (const mesh of granny.meshes) mesh.isPickable = false;
  for (const surface of scene.materials) {
    if ('maxSimultaneousLights' in surface) surface.maxSimultaneousLights = 6;
  }
  const introClip = granny.animationGroups[0];
  if (!introClip) throw new Error('Granny’s intro animation is missing.');
  const introFps = introClip.targetedAnimations[0].animation.framePerSecond;
  introClip.start(false);
  introClip.pause();

  function poseGranny(time) {
    introClip.goToFrame(Math.min(introClip.to, introClip.from + time * introFps));
  }

  let phase = 'title';
  let phaseStart = performance.now();
  let busy = false;
  const displayed = [...game.pits];
  const layer = $('pit-layer');
  const counts = PITS.map((_, i) => {
    const element = document.createElement(ROWS[PLAYER].includes(i) ? 'button' : 'div');
    element.className = 'pit-count' + (STORES.includes(i) ? ' store' : '');
    const label = document.createElement('span');
    element.append(label);
    layer.append(element);
    if (element instanceof HTMLButtonElement) {
      element.type = 'button';
      element.addEventListener('click', () => void selectPit(i));
    } else {
      element.setAttribute('role', 'img');
    }
    return { element, label };
  });

  function view(pose) {
    camera.position.set(...pose.position);
    camera.fov = pose.fov ?? DEFAULT_FOV;
    camera.upVector.set(Math.sin(pose.roll), Math.cos(pose.roll), 0);
    camera.setTarget(Vector3.FromArray(pose.target));
  }

  function overheadPose() {
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    // Keep the camera below the rafters and fit narrow windows with the lens.
    const height = 1.65;
    const fov = 2 * Math.atan(Math.max(1.18, 2.82 / aspect) / (2 * height));
    return { position: [0, BOARD_TOP + height, 0.045], target: [0, BOARD_TOP, 0], roll: 0, fov };
  }

  function layOutPits() {
    const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    const transform = scene.getTransformMatrix();
    const project = (x, z) => Vector3.Project(new Vector3(x, BOARD_TOP, z), Matrix.IdentityReadOnly, transform, viewport);
    for (const [i, pit] of PITS.entries()) {
      const center = project(pit.x, pit.z);
      const { element } = counts[i];
      element.style.left = center.x + 'px';
      element.style.top = center.y + 'px';
      element.style.width = (project(pit.x + pit.rx, pit.z).x - project(pit.x - pit.rx, pit.z).x) + 'px';
      element.style.height = Math.abs(project(pit.x, pit.z + pit.rz).y - project(pit.x, pit.z - pit.rz).y) + 'px';
    }
  }

  function showCount(pit, count) {
    displayed[pit] = count;
    const { element, label } = counts[pit];
    label.textContent = count;
    const column = ROWS[PLAYER].indexOf(pit);
    const name = column >= 0 ? 'Your pit ' + (column + 1)
      : pit === STORES[PLAYER] ? 'Your store'
      : pit === STORES[GRANNY] ? 'Granny’s store'
      : 'Granny’s pit ' + (ROWS[GRANNY].indexOf(pit) + 1);
    element.setAttribute('aria-label', name + ', ' + count + (count === 1 ? ' seed' : ' seeds'));
    $('player-score').textContent = displayed[STORES[PLAYER]];
    $('granny-score').textContent = displayed[STORES[GRANNY]];
  }

  function mark(...pits) {
    for (const [index, { element }] of counts.entries()) {
      element.classList.toggle('active', pits.includes(index));
    }
    board.mark(pits);
  }

  function updatePitButtons() {
    const legal = phase === 'game' && !busy && game.turn === PLAYER ? legalPits(game) : [];
    for (const pit of ROWS[PLAYER]) counts[pit].element.disabled = !legal.includes(pit);
  }

  function status(title, hint) {
    $('turn-title').textContent = title;
    $('turn-hint').textContent = hint;
  }

  function showHand(seeds, location = 'in hand') {
    handCount.hidden = seeds === undefined;
    if (!handCount.hidden) handCount.textContent = seeds + (seeds === 1 ? ' seed ' : ' seeds ') + location;
  }

  function enterMatch() {
    game = newGame();
    board.reset(game.pits);
    game.pits.forEach((count, pit) => showCount(pit, count));
    mark();
    busy = false;
    phase = 'game';
    match.hidden = false;
    $('result').hidden = true;
    status('Your turn', 'Choose an occupied pit on the near row. You can also press 1–7.');
    updatePitButtons();
    layOutPits();
  }

  function endMatch() {
    updatePitButtons();
    const title = { win: 'You win', loss: 'Granny wins', draw: 'A draw' }[game.outcome];
    status(title, 'All 98 seeds have been scored.');
    $('result-title').textContent = title;
    $('result-score').textContent = 'You ' + game.pits[STORES[PLAYER]] + ' · Granny ' + game.pits[STORES[GRANNY]];
    $('result').hidden = false;
    again.focus();
  }

  async function animateTransfer(step, mover, captured) {
    const { kind, pit, count, emptied } = step;
    const sources = emptied.filter((source) => displayed[source] > 0);
    if (kind === 'sweep') {
      status('The round is over', 'The remaining seeds go to their owner’s store.');
    } else {
      const title = mover === PLAYER ? 'You capture ' + captured : 'Granny captures ' + captured;
      status(title, kind === 'capture' ? 'Seeds from the opposite pit cross the board.'
        : 'The captured pile goes into the store.');
    }
    showHand();
    mark(...sources, pit);
    await wait(kind === 'bank' ? 280 : 400);
    const inTransit = sources.reduce((sum, source) => sum + displayed[source], 0);
    for (const source of sources) showCount(source, 0);
    showHand(inTransit, 'in transit');
    await board.transfer(sources, pit, kind === 'capture' ? 900 : 1100);
    showCount(pit, count);
    showHand();
    mark(pit);
    await wait(kind === 'capture' ? 650 : 700);
  }

  async function animateMove(pit) {
    const mover = game.turn;
    const move = playMove(game, pit);
    const drops = move.steps.filter((step) => step.kind === 'drop').length;
    const dropMs = Math.max(260, 500 - 8 * Math.max(0, drops - 12));
    const sowing = mover === PLAYER ? 'You’re sowing' : 'Granny is sowing';
    status(sowing, 'Seeds travel clockwise around the board.');
    for (const step of move.steps) {
      switch (step.kind) {
        case 'lift':
          mark(step.pit);
          if (step !== move.steps[0]) status(sowing, 'An occupied pit started a relay. Sowing continues from there.');
          await wait(280);
          showCount(step.pit, 0);
          showHand(step.hand);
          await board.lift(step.pit, 400);
          await wait(210);
          break;
        case 'drop':
          await board.drop(step.pit, dropMs);
          showCount(step.pit, step.count);
          mark(step.pit);
          showHand(step.hand);
          await wait(dropMs * 0.18);
          break;
        default:
          await animateTransfer(step, mover, move.captured);
      }
    }
    game = move.game;
    showHand();
    mark();
    if (move.bonus && !game.outcome) {
      status(mover === PLAYER ? 'Play again' : 'Granny plays again', 'The last seed landed in the store.');
    }
    return move;
  }

  async function selectPit(pit) {
    if (phase !== 'game' || busy || game.turn !== PLAYER || !legalPits(game).includes(pit)) return;
    busy = true;
    updatePitButtons();
    const move = await animateMove(pit);
    let grannyBonus = false;
    while (game.turn === GRANNY && !game.outcome) {
      status('Granny is thinking', grannyBonus ? 'She earned another turn.' : 'She’s choosing a pit.');
      mark(...ROWS[GRANNY], STORES[GRANNY]);
      await wait(1100);
      grannyBonus = (await animateMove(chooseGrannyPit(game))).bonus;
    }
    busy = false;
    if (game.outcome) {
      endMatch();
    } else {
      status(move.bonus ? 'Play again' : 'Your turn', 'Choose an occupied pit on the near row. You can also press 1–7.');
      updatePitButtons();
    }
  }

  wake.addEventListener('click', () => {
    $('intro').hidden = true;
    if (!reducedMotion) $('eyelids').classList.add('opening');
    phase = 'wake';
    phaseStart = performance.now();
  });
  sit.addEventListener('click', () => {
    $('invitation').hidden = true;
    phase = 'sit';
    phaseStart = performance.now();
  });
  again.addEventListener('click', enterMatch);
  window.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (/^[1-7]$/.test(event.key)) void selectPit(ROWS[PLAYER][Number(event.key) - 1]);
  });
  window.addEventListener('resize', () => engine.resize());

  wake.disabled = false;
  wake.textContent = 'Wake up';
  wake.focus({ preventScroll: true });
  let previousWidth = 0;
  let previousHeight = 0;
  engine.runRenderLoop(() => {
    const now = performance.now();
    const elapsed = (now - phaseStart) / 1000;
    let overhead = 0;
    let needsLayout = false;
    if (phase === 'title') {
      view(WAITING_POSE);
    } else if (phase === 'wake') {
      const time = reducedMotion ? INVITATION_TIME : Math.min(elapsed, INVITATION_TIME);
      view(wakePose(time));
      poseGranny(time);
      if (time >= INVITATION_TIME) {
        phase = 'invitation';
        $('invitation').hidden = false;
        sit.focus({ preventScroll: true });
      }
    } else if (phase === 'sit') {
      const time = reducedMotion ? OVERHEAD_START + OVERHEAD_DURATION : elapsed;
      poseGranny(INVITATION_TIME + time);
      if (time < SIT_DURATION) {
        view(blendPose(wakePose(INVITATION_TIME), SEATED_POSE, ease(time / SIT_DURATION)));
      } else {
        overhead = ease(Math.max(0, Math.min(1, (time - OVERHEAD_START) / OVERHEAD_DURATION)));
        view(blendPose(SEATED_POSE, overheadPose(), overhead));
      }
      if (time >= OVERHEAD_START + OVERHEAD_DURATION) needsLayout = true;
    } else if (phase === 'game') {
      overhead = 1;
      view(overheadPose());
    }
    room.update(now / 1000, overhead);
    scene.render();
    if (needsLayout) enterMatch();
    if (phase === 'game' && (previousWidth !== canvas.clientWidth || previousHeight !== canvas.clientHeight)) {
      layOutPits();
      previousWidth = canvas.clientWidth;
      previousHeight = canvas.clientHeight;
    }
  });
}

launch().catch((error) => {
  console.error(error);
  wake.textContent = 'Unable to start';
  $('error').textContent = 'The scene couldn’t load. ' + error.message;
  $('error').hidden = false;
});
