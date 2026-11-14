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
import { PLAYER, GRANNY, ROWS, STORES, burnablePits, burnPit, chooseGrannyPit, legalPits, newGame, playMove, stealPlayerPit } from './congklak.js';
import { BURN_DIALOGUE } from './burn-dialogue.js';
import { buildRulebook } from './rulebook.js';
import { createGameAudio } from './audio.js';
import { mountSmartSpectra } from './smart-spectra-panel.js';
import { FacialHurdles } from './facial-hurdles.js';
import { createUpsideDownGranny } from './upside-down-granny.js';
import { ProgressStore, browserProgressStorage, validCheckpoint } from './progress-store.js';

const spectra = mountSmartSpectra();

const $ = (id) => document.getElementById(id);
const wake = $('wake');
const sit = $('sit');
const again = $('again');
const match = $('match');
const result = $('result');
const dialogue = $('burn-dialogue');
const dialogueButton = $('dialogue-continue');
const rulebookButton = $('rulebook-button');
const reader = $('book-reader');
const bookPrevious = $('book-previous');
const bookNext = $('book-next');
const bookClose = $('book-close');
const canvas = $('scene');
const handCount = $('hand-count');
const settingsDialog = $('settings-dialog');
const settingsButton = $('settings-button');
const continueRun = $('continue-run');
const PIT_CHOICE_HINT = 'Choose an occupied pit on the near row. You can also press 1–' + ROWS[PLAYER].length + '.';
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
const LOSS_DURATION = 1.55;
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
  const storage = window.grannyProgress ? {
    async read() {
      const result = await window.grannyProgress.load();
      if (result.error) throw new Error('Local save unavailable.');
      return result.data;
    },
    async write(json) {
      const result = await window.grannyProgress.save(json);
      if (!result.ok) throw new Error('Local save unavailable.');
    },
  } : browserProgressStorage();
  const progress = await ProgressStore.load(storage);
  const preferences = progress.settings;
  const sound = createGameAudio();
  sound.setMuted(!preferences.sound);
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.048, 0.035, 0.039, 1);
  scene.skipPointerMovePicking = true;
  const camera = new FreeCamera('First-person camera', Vector3.Zero(), scene);
  camera.minZ = 0.045;
  camera.maxZ = 22;
  const aspect = () => canvas.clientWidth / Math.max(canvas.clientHeight, 1);
  const room = buildRoom(scene);
  let game = newGame();
  const rulebook = buildRulebook(scene, camera, aspect, reducedMotion, game.escapePattern);
  const glow = new GlowLayer('Candle bloom', scene, { mainTextureFixedSize: 256, blurKernelSize: 42 });
  glow.intensity = 0.48;
  for (const flame of room.flames) glow.addIncludedOnlyMesh(flame);
  const board = buildBoard(scene, game.pits, reducedMotion);
  for (const flame of board.fireMeshes) glow.addIncludedOnlyMesh(flame);

  RegisterSceneLoaderPlugin(new GLTFFileLoader());
  const granny = await LoadAssetContainerAsync(modelUrl, scene);
  granny.addAllToScene();
  for (const mesh of granny.meshes) mesh.isPickable = false;
  for (const surface of scene.materials) {
    if ('maxSimultaneousLights' in surface) surface.maxSimultaneousLights = 6;
  }
  const introClip = granny.animationGroups[0];
  const grannyRoot = granny.transformNodes.find((node) => node.name === 'Granny');
  const grannyHead = granny.transformNodes.find((node) => node.name === 'Head');
  if (!introClip || !grannyRoot || !grannyHead) throw new Error('Granny’s rig or intro animation is missing.');
  const introFps = introClip.targetedAnimations[0].animation.framePerSecond;
  introClip.start(false);
  introClip.pause();
  const upsideDown = createUpsideDownGranny(scene, camera, grannyHead, reducedMotion);

  function poseGranny(time) {
    introClip.goToFrame(Math.min(introClip.to, introClip.from + time * introFps));
  }

  let phase = 'title';
  let phaseStart = performance.now();
  let busy = false;
  let stare;
  let tableShot;
  let burnLine;
  let readerSpread = 0;
  let readerBusy = false;
  let resumePhase;
  const hurdles = new FacialHurdles();
  let facialShot;
  let roundCheckpoint = null;
  let deathCheckpoint = null;
  let lastEnding = null;
  const facialEncounter = $('facial-encounter');
  const displayed = [...game.pits];
  const layer = $('pit-layer');
  const counts = PITS.map((_, i) => {
    const element = document.createElement(STORES.includes(i) ? 'div' : 'button');
    element.className = 'pit-count';
    element.classList.toggle('store', STORES.includes(i));
    element.classList.toggle('granny-side', ROWS[GRANNY].includes(i) || i === STORES[GRANNY]);
    const label = document.createElement('span');
    element.append(label);
    layer.append(element);
    if (element instanceof HTMLButtonElement) {
      element.type = 'button';
      element.addEventListener('click', () => {
        if (phase === 'burn') void selectBurn(i);
        else void selectPit(i);
      });
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

  function poseStare(elapsed) {
    if (!stare.sounded && (reducedMotion || elapsed >= 0.16)) {
      stare.sounded = true;
      sound.scream();
    }
    const lunge = reducedMotion ? 1 : ease(Math.max(0, Math.min(1, (elapsed - 0.16) / 0.27)));
    const distance = (stare.close ? 0.22 : 1.76) * lunge;
    // Clear the table early in the lunge so the close-up reads as a jump.
    const lift = (stare.close ? 0.03 : 0.42) * ease(Math.min(1, lunge / 0.55))
      + (stare.close ? 0.01 : 0.045) * Math.sin(Math.PI * lunge);
    grannyRoot.position.set(stare.origin.x, stare.origin.y + lift, stare.origin.z + distance);
    const { x, y, z } = stare.eyes;
    view({
      position: [x, y + lift + 0.025 + (stare.close ? 0 : 0.14) * (1 - lunge), z + (stare.close ? 0.46 : 2.10)],
      target: [x, y + lift - 0.040, z + distance],
      roll: 0,
      fov: 0.66,
    });
    return lunge;
  }

  function overheadPose() {
    // Keep the camera below the rafters and fit narrow windows with the lens.
    const height = 1.65;
    const fov = 2 * Math.atan(Math.max(1.18, 2.82 / aspect()) / (2 * height));
    return { position: [0, BOARD_TOP + height, 0.045], target: [0, BOARD_TOP, 0], roll: 0, fov };
  }

  const overheadShot = () => ({ pose: overheadPose(), overhead: 1 });
  const seatedShot = () => ({ pose: SEATED_POSE, overhead: 0 });

  function capturePose() {
    return { position: camera.position.asArray(), target: camera.getTarget().asArray(), roll: 0, fov: camera.fov };
  }

  function beginHappyEncounter() {
    phase = 'facial-happy';
    facialShot = {
      start: performance.now(), from: capturePose(),
      eyes: Vector3.TransformCoordinates(new Vector3(0, 0.111, 0.0915), grannyHead.computeWorldMatrix(true)),
    };
    match.hidden = true;
    facialEncounter.hidden = false;
    updatePitButtons();
  }

  function returnFromHappy() {
    phase = 'facial-return';
    facialShot = { start: performance.now(), from: capturePose() };
    facialEncounter.hidden = true;
    sound.stopThreat();
  }

  function updateFacialHurdles(deltaMs) {
    if (phase !== 'game' && phase !== 'facial-happy') return;
    const signals = spectra.gameplaySignals();
    const focused = !document.hidden && document.hasFocus()
      && !settingsDialog.open
      && !document.activeElement?.closest?.('#spectra-key-form, #spectra-camera-picker');
    const pausedHint = settingsDialog.open ? 'Paused while Settings are open.' : 'Paused while you are away from the game.';
    const event = hurdles.step(deltaMs, {
      choosing: phase === 'game' && !busy && game.turn === PLAYER && !game.outcome,
      focused, expression: signals.expression, facing: signals.facing,
    });
    if (event === 'happy-start') beginHappyEncounter();
    if (event === 'away-start') {
      upsideDown.show(performance.now());
      match.classList.add('away-encounter');
      spectra.setEncounter('away');
      updatePitButtons();
    }
    if (event === 'happy-pass') returnFromHappy();
    if (event === 'happy-fail') startStare({ close: true, reason: 'Granny did not believe your smile.' });
    if (event === 'away-penalty') void applyAwayPenalty();
    if (hurdles.active === 'away') {
      if (!busy) {
        const hint = !focused ? pausedHint
          : !signals.healthy || signals.facing === null ? 'Tracking paused. Reconnect the camera, or switch facial hurdles off.'
          : hurdles.awayPenalized ? 'She has taken her due. Choose a pit to send her away.'
          : 'Look away from the camera while choosing an occupied pit on your side.';
        status(hurdles.awayPenalized ? 'Granny has taken her harvest' : ['Do not look at her', 'She can see you looking', 'Look away, child'][hurdles.stage], hint);
      }
      if (focused && signals.healthy && signals.facing !== null && !hurdles.awayPenalized && !busy) sound.threat(hurdles.pressure, true);
      else sound.stopThreat();
    }
    if (phase === 'facial-happy') {
      const lines = ['“Are you having fun, child?”', '“Is that all the joy you have for Granny?”', '“Smile. For Granny.”'];
      const line = lines[hurdles.stage];
      if ($('facial-line').textContent !== line) $('facial-line').textContent = line;
      facialEncounter.dataset.stage = String(hurdles.stage);
      const hint = !focused ? pausedHint
        : !signals.expression ? 'Tracking paused. Face the camera in even light, or turn facial hurdles off.' : '';
      if ($('facial-tracking').textContent !== hint) $('facial-tracking').textContent = hint;
      if (focused && signals.expression) sound.threat(hurdles.pressure);
      else sound.stopThreat();
    }
  }

  function setFacialMode(enabled, startCamera = false) {
    hurdles.setEnabled(enabled);
    if (enabled && startCamera) void spectra.ensureCamera();
    if (!enabled) {
      sound.stopThreat();
      upsideDown.dismiss(performance.now());
      match.classList.remove('away-encounter');
      spectra.setEncounter(null);
      if (phase === 'facial-happy') returnFromHappy();
      else if (phase === 'game' && !busy) status('Your turn', PIT_CHOICE_HINT);
    }
    updatePitButtons();
  }

  function updateResultControls() {
    const death = phase === 'game-over' || (phase === 'ending-result' && lastEnding === 'false');
    const retry = death && preferences.saveProgress && deathCheckpoint !== null;
    again.textContent = retry ? 'Retry round' : phase === 'draw' ? 'Replay round' : 'Start new game';
    $('new-game').hidden = !retry && phase !== 'draw';
    $('retry-hint').textContent = retry
      ? 'Restart round ' + (deathCheckpoint.burned.length + 1) + '. Your burned pits and rulebook clue are kept.'
      : death ? 'This run has ended. Saving is off or no round checkpoint is available.' : '';
  }

  function updateProgressUI() {
    const checkpoint = progress.getCheckpoint();
    continueRun.hidden = !checkpoint;
    continueRun.textContent = checkpoint ? 'Continue · Round ' + (checkpoint.burned.length + 1) : 'Continue';
    if (!wake.disabled) wake.textContent = checkpoint ? 'New game' : 'Wake up';
    const saved = checkpoint ? 'Round ' + (checkpoint.burned.length + 1) + ' saved on this device. ' + checkpoint.burned.length + ' burned pits kept.' : 'Your round will be saved on this device.';
    $('save-status').textContent = progress.issue || (preferences.saveProgress ? saved : 'Saving off. Death ends the run.');
    $('save-status').dataset.error = String(Boolean(progress.issue));
    $('intro-save-status').textContent = progress.issue || (checkpoint ? 'Continue restarts the saved round with burned pits and the same clue.' : '');
    if (!result.hidden) updateResultControls();
  }

  function recordRoundCheckpoint() {
    roundCheckpoint = validCheckpoint(game);
    if (preferences.saveProgress && roundCheckpoint) void progress.saveRound(roundCheckpoint).then(updateProgressUI);
    else updateProgressUI();
  }

  settingsButton.addEventListener('click', () => {
    if (!settingsDialog.open) settingsDialog.showModal();
    sound.stopThreat();
    updateProgressUI();
  });
  for (const id of ['settings-close', 'settings-done']) $(id).addEventListener('click', () => settingsDialog.close());
  settingsDialog.addEventListener('close', () => { $('spectra-key').value = ''; settingsButton.focus({ preventScroll: true }); });
  for (const [id, key] of [['setting-sound', 'sound'], ['setting-facial', 'facialHurdles'], ['setting-save', 'saveProgress'], ['setting-camera', 'showCamera']]) {
    $(id).checked = preferences[key];
    $(id).addEventListener('change', () => {
      const value = $(id).checked;
      void progress.updateSettings({ [key]: value }).then(updateProgressUI);
      if (key === 'sound') sound.setMuted(!value);
      if (key === 'facialHurdles') setFacialMode(value, value);
      if (key === 'showCamera') spectra.setPreviewVisible(value);
      if (key === 'saveProgress') {
        if (!value) deathCheckpoint = null;
        else if (roundCheckpoint && !lastEnding && !['title', 'loss-stare', 'game-over', 'ending-result'].includes(phase)) {
          void progress.saveRound(roundCheckpoint).then(updateProgressUI);
        }
      }
      updateProgressUI();
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) sound.stopThreat(); });
  window.addEventListener('blur', () => sound.stopThreat());

  function fireShot(pit) {
    const { x, z } = PITS[pit];
    return {
      pose: {
        position: [x + 0.14, BOARD_TOP + 0.70, z + 0.76],
        target: [x, BOARD_TOP + 0.10, z],
        roll: 0,
        fov: 0.62,
      },
      overhead: 0.38,
    };
  }

  function panTableTo(to, ms) {
    const from = tableShot ?? overheadShot;
    const start = performance.now();
    return new Promise((resolve) => {
      tableShot = (now) => {
        const t = reducedMotion ? 1 : Math.min(1, (now - start) / ms);
        const end = to();
        if (t === 1) {
          tableShot = to;
          resolve();
          return end;
        }
        const first = from();
        const amount = ease(t);
        return {
          pose: blendPose(first.pose, end.pose, amount),
          overhead: first.overhead + (end.overhead - first.overhead) * amount,
        };
      };
    });
  }

  function layOutPits() {
    const viewport = camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    const transform = scene.getTransformMatrix();
    const projectPoint = (x, y, z) => Vector3.Project(new Vector3(x, y, z), Matrix.IdentityReadOnly, transform, viewport);
    const project = (x, z) => projectPoint(x, BOARD_TOP, z);
    for (const [i, pit] of PITS.entries()) {
      const center = project(pit.x, pit.z);
      const { element } = counts[i];
      element.style.left = center.x + 'px';
      element.style.top = center.y + 'px';
      element.style.width = (project(pit.x + pit.rx, pit.z).x - project(pit.x - pit.rx, pit.z).x) + 'px';
      element.style.height = Math.abs(project(pit.x, pit.z + pit.rz).y - project(pit.x, pit.z - pit.rz).y) + 'px';
    }
    const { x, y, z } = rulebook.tableCenter;
    const center = projectPoint(x, y, z);
    rulebookButton.style.left = center.x + 'px';
    rulebookButton.style.top = center.y + 'px';
    rulebookButton.style.width = Math.max(42, projectPoint(x + 0.125, y, z).x - projectPoint(x - 0.125, y, z).x) + 'px';
    rulebookButton.style.height = Math.max(42, Math.abs(projectPoint(x, y, z + 0.17).y - projectPoint(x, y, z - 0.17).y)) + 'px';
  }

  function pitName(pit) {
    const column = ROWS[PLAYER].indexOf(pit);
    return column >= 0 ? 'Your pit ' + (column + 1)
      : pit === STORES[PLAYER] ? 'Your store'
      : pit === STORES[GRANNY] ? 'Granny’s store'
      : 'Granny’s pit ' + (ROWS[GRANNY].indexOf(pit) + 1);
  }

  function showCount(pit, count) {
    displayed[pit] = count;
    const { element, label } = counts[pit];
    const burned = game.burned.includes(pit);
    label.textContent = burned ? '×' : count;
    element.classList.toggle('burned', burned);
    const detail = burned ? 'burned' : count + (count === 1 ? ' seed' : ' seeds');
    element.setAttribute('aria-label', pitName(pit) + ', ' + detail);
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
    const canBurn = phase === 'burn' ? burnablePits(game) : [];
    for (const pit of ROWS.flat()) {
      const { element } = counts[pit];
      const burnable = canBurn.includes(pit);
      element.disabled = !legal.includes(pit) && !burnable;
      element.classList.toggle('burnable', burnable);
      if (burnable) element.setAttribute('aria-label', 'Burn ' + pitName(pit));
    }
    rulebookButton.disabled = hurdles.active === 'away' || (phase !== 'burn' && (phase !== 'game' || busy || game.turn !== PLAYER || game.outcome !== null));
  }

  function updateReader() {
    bookPrevious.disabled = readerBusy || readerSpread === 0;
    bookNext.disabled = readerBusy || readerSpread === rulebook.spreadCount - 1;
    bookClose.disabled = readerBusy;
    if (readerBusy) return;
    $('book-page').textContent = (readerSpread + 1) + ' / ' + rulebook.spreadCount;
    $('book-text').textContent = rulebook.describe(readerSpread);
  }

  async function openRulebook() {
    if (rulebookButton.disabled || match.hidden) return;
    resumePhase = phase;
    phase = 'book';
    readerBusy = true;
    match.hidden = true;
    updatePitButtons();
    await rulebook.open();
    readerSpread = 0;
    readerBusy = false;
    reader.hidden = false;
    updateReader();
    bookNext.focus({ preventScroll: true });
  }

  async function turnBook(offset) {
    const next = readerSpread + offset;
    if (phase !== 'book' || readerBusy || next < 0 || next >= rulebook.spreadCount) return;
    readerBusy = true;
    updateReader();
    await rulebook.flip(next);
    readerSpread = next;
    readerBusy = false;
    updateReader();
    const control = offset < 0 ? bookPrevious : bookNext;
    (control.disabled ? bookClose : control).focus({ preventScroll: true });
  }

  async function closeRulebook() {
    if (phase !== 'book' || readerBusy) return;
    readerBusy = true;
    reader.hidden = true;
    await rulebook.close();
    phase = resumePhase;
    readerBusy = false;
    match.hidden = false;
    layOutPits();
    updatePitButtons();
    rulebookButton.focus({ preventScroll: true });
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
    upsideDown.hide();
    match.classList.remove('away-encounter');
    spectra.setEncounter(null);
    hurdles.resetChoice();
    tableShot = undefined;
    game = newGame(game.burned, game.escapePattern);
    lastEnding = null;
    deathCheckpoint = null;
    board.reset(game.pits);
    board.setBurned(game.burned);
    game.pits.forEach((count, pit) => showCount(pit, count));
    mark();
    busy = false;
    phase = 'game';
    match.hidden = false;
    result.hidden = true;
    $('round-label').textContent = 'Round ' + (game.burned.length + 1);
    status('Your turn', PIT_CHOICE_HINT);
    recordRoundCheckpoint();
    updatePitButtons();
    layOutPits();
  }

  function endMatch() {
    upsideDown.hide();
    match.classList.remove('away-encounter');
    spectra.setEncounter(null);
    hurdles.resetChoice();
    if (game.outcome === 'win') {
      void offerBurn();
    } else if (game.outcome === 'draw') {
      phase = 'draw';
      status('A draw', 'Replay with the same pits.');
      showResult('A draw');
    } else {
      startStare();
    }
    updatePitButtons();
  }

  function startStare({ close = false, reason = '' } = {}) {
    deathCheckpoint = preferences.saveProgress && roundCheckpoint ? validCheckpoint(roundCheckpoint) : null;
    upsideDown.hide();
    match.classList.remove('away-encounter');
    spectra.setEncounter(null);
    sound.stopThreat();
    facialEncounter.hidden = true;
    facialShot = undefined;
    phase = 'loss-stare';
    phaseStart = performance.now();
    match.hidden = true;
    stare = {
      close, reason,
      origin: grannyRoot.position.clone(),
      eyes: Vector3.TransformCoordinates(new Vector3(0, 0.111, 0.0915), grannyHead.computeWorldMatrix(true)),
    };
  }

  function showResult(title) {
    const [playerScore, grannyScore] = STORES.map((pit) => game.pits[pit]);
    $('result-title').textContent = title;
    $('result-score').textContent = 'You ' + playerScore + ' · Granny ' + grannyScore
      + (phase === 'game-over' && stare?.reason ? ' · ' + stare.reason : '');
    result.classList.toggle('game-over', phase === 'game-over');
    updateResultControls();
    result.hidden = false;
    again.focus({ preventScroll: true });
  }

  function speak(line, action) {
    $('granny-line').textContent = '“' + line + '”';
    dialogueButton.textContent = action;
    dialogue.hidden = false;
    dialogueButton.focus({ preventScroll: true });
    return new Promise((resolve) => {
      dialogueButton.addEventListener('click', () => {
        dialogue.hidden = true;
        resolve();
      }, { once: true });
    });
  }

  async function offerBurn() {
    phase = 'burn-scene';
    match.hidden = true;
    burnLine = BURN_DIALOGUE[game.burned.length] ?? BURN_DIALOGUE.at(-1);
    await panTableTo(seatedShot, 850);
    await speak(burnLine.ask, 'Choose a pit');
    await panTableTo(overheadShot, 700);
    phase = 'burn';
    match.hidden = false;
    status('You win', 'Choose a small pit on either side to burn.');
    layOutPits();
    updatePitButtons();
    counts[burnablePits(game)[0]].element.focus({ preventScroll: true });
  }

  async function selectBurn(pit) {
    if (phase !== 'burn' || !burnablePits(game).includes(pit)) return;
    const { burned, ending } = burnPit(game, pit);
    phase = 'burn-scene';
    updatePitButtons();
    match.hidden = true;
    await panTableTo(() => fireShot(pit), 450);
    sound.ignite(PITS[pit].x);
    await board.ignite(pit);
    game = { ...game, burned };
    if (!ending) recordRoundCheckpoint();
    else if (ending === 'true') {
      roundCheckpoint = null;
      void progress.clearCheckpoint().then(updateProgressUI);
    }
    board.setBurned(burned);
    showCount(pit, 0);
    await wait(250);
    await panTableTo(seatedShot, 650);
    await speak(burnLine.after, ending ? 'Continue' : 'Next round');
    if (ending) {
      await playEnding(ending);
      return;
    }
    await panTableTo(overheadShot, 700);
    enterMatch();
  }

  async function playEnding(ending) {
    lastEnding = ending;
    if (ending === 'false') deathCheckpoint = preferences.saveProgress && roundCheckpoint ? validCheckpoint(roundCheckpoint) : null;
    if (ending === 'no-ground') {
      await speak('You burned all your own ground. Where will you stand now?', 'Continue');
      startStare();
      return;
    }

    if (ending === 'false') {
      await speak('You have burnt every field of mine. Go on, child. The door is open.', 'Stand up');
      await panTableTo(() => ({
        pose: { position: [-0.60, 1.46, 1.34], target: [-0.19, 1.06, -1.90], roll: 0 },
        overhead: 0,
      }), 720);
      await speak('Ash needs feeding. Stay a little longer. You’ll make good compost for the next crop.', 'Continue');
      sound.ignite(-0.54);
      await board.flareAt(-0.54, 1.13, 0.98, 1.45, 1550);
    } else {
      await speak('Four scars. You left enough earth for another crop. The fire knows my name now.', 'Continue');
      await panTableTo(() => ({
        pose: { position: [-0.14, 1.28, 1.31], target: [0, 1.01, -1.23], roll: 0, fov: 0.65 },
        overhead: 0,
      }), 640);
      sound.ignite();
      sound.scream(true);
      await board.flareAt(0, 0.59, -1.01, 2.8, 1850);
      grannyRoot.setEnabled(false);
    }

    $('ending-shade').classList.add('dark');
    await wait(reducedMotion ? 0 : 550);
    phase = 'ending-result';
    showResult(ending === 'true' ? 'True ending' : 'False ending');
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
          sound.seedDrop(PITS[step.pit].x);
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
    upsideDown.dismiss(performance.now());
    match.classList.remove('away-encounter');
    sound.stopThreat();
    spectra.setEncounter(null);
    hurdles.resetChoice();
    updatePitButtons();
    const move = await animateMove(pit);
    let grannyBonus = false;
    while (game.turn === GRANNY && !game.outcome) {
      status('Granny is thinking', grannyBonus ? 'She earned another turn.' : 'She’s choosing a pit.');
      mark(...ROWS[GRANNY].filter((smallPit) => !game.burned.includes(smallPit)), STORES[GRANNY]);
      await wait(1100);
      grannyBonus = (await animateMove(chooseGrannyPit(game))).bonus;
    }
    busy = false;
    if (game.outcome) {
      endMatch();
    } else {
      status(move.bonus ? 'Play again' : 'Your turn', PIT_CHOICE_HINT);
      updatePitButtons();
    }
  }

  async function applyAwayPenalty() {
    if (phase !== 'game' || busy || game.turn !== PLAYER || game.outcome) return;
    const theft = stealPlayerPit(game);
    busy = true;
    updatePitButtons();
    sound.stopThreat();
    sound.scream(false, 0.19);
    status('Granny steals ' + theft.seeds + ' seeds', 'One of your occupied pits goes into her store.');
    mark(theft.source, STORES[GRANNY]);
    showCount(theft.source, 0);
    showHand(theft.seeds, 'in transit');
    await board.transfer([theft.source], STORES[GRANNY], 1100);
    showCount(STORES[GRANNY], theft.steps[0].count);
    showHand();
    for (const step of theft.steps.slice(1)) await animateTransfer(step, GRANNY, 0);
    game = theft.game;
    mark();
    busy = false;
    if (game.outcome) endMatch();
    else updatePitButtons();
  }

  function resetEncounterView() {
    sound.stopThreat();
    upsideDown.hide();
    match.classList.remove('away-encounter');
    spectra.setEncounter(null);
    hurdles.resetChoice();
    facialEncounter.hidden = true;
    facialShot = undefined;
    stare = undefined;
    tableShot = undefined;
    dialogue.hidden = true;
    reader.hidden = true;
    $('invitation').hidden = true;
    $('ending-shade').classList.remove('dark');
    result.hidden = true;
    grannyRoot.setEnabled(true);
    showHand();
    mark();
    if (settingsDialog.open) settingsDialog.close();
  }

  function restoreRound(checkpoint) {
    const saved = validCheckpoint(checkpoint);
    if (!saved) return;
    resetEncounterView();
    game = newGame(saved.burned, saved.escapePattern);
    rulebook.setPattern(game.escapePattern);
    poseGranny(INVITATION_TIME + OVERHEAD_START + OVERHEAD_DURATION);
    $('intro').hidden = true;
    phase = 'game';
    view(overheadPose());
    scene.render();
    enterMatch();
    counts[legalPits(game)[0]].element.focus({ preventScroll: true });
    sound.start();
    if (preferences.facialHurdles) void spectra.ensureCamera();
  }

  function startNewGame() {
    resetEncounterView();
    game = newGame();
    roundCheckpoint = null;
    deathCheckpoint = null;
    lastEnding = null;
    busy = false;
    phase = 'title';
    phaseStart = performance.now();
    poseGranny(0);
    rulebook.setPattern(game.escapePattern);
    board.reset(game.pits);
    board.setBurned(game.burned);
    game.pits.forEach((count, pit) => showCount(pit, count));
    match.hidden = true;
    $('intro').hidden = false;
    void progress.clearCheckpoint().then(updateProgressUI);
    updateProgressUI();
    updatePitButtons();
    wake.focus({ preventScroll: true });
  }

  wake.addEventListener('click', () => {
    sound.start();
    if (preferences.facialHurdles) void spectra.ensureCamera();
    recordRoundCheckpoint();
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
  again.addEventListener('click', () => {
    if (phase === 'draw') enterMatch();
    else if (phase === 'game-over' || phase === 'ending-result') {
      if (preferences.saveProgress && deathCheckpoint) restoreRound(deathCheckpoint);
      else startNewGame();
    }
  });
  $('new-game').addEventListener('click', startNewGame);
  continueRun.addEventListener('click', () => {
    const checkpoint = progress.getCheckpoint();
    if (checkpoint) restoreRound(checkpoint);
  });
  rulebookButton.addEventListener('click', () => void openRulebook());
  bookPrevious.addEventListener('click', () => void turnBook(-1));
  bookNext.addEventListener('click', () => void turnBook(1));
  bookClose.addEventListener('click', () => void closeRulebook());
  window.addEventListener('keydown', (event) => {
    if (settingsDialog.open) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    if (phase === 'book') {
      if (event.key === 'ArrowLeft') void turnBook(-1);
      if (event.key === 'ArrowRight') void turnBook(1);
      if (event.key === 'Escape') void closeRulebook();
      return;
    }
    const pit = ROWS[PLAYER][Number(event.key) - 1];
    if (pit !== undefined) void selectPit(pit);
  });
  window.addEventListener('resize', () => engine.resize());

  wake.disabled = false;
  settingsButton.disabled = false;
  setFacialMode(preferences.facialHurdles);
  spectra.setPreviewVisible(preferences.showCamera);
  updateProgressUI();
  (continueRun.hidden ? wake : continueRun).focus({ preventScroll: true });
  let previousWidth = 0;
  let previousHeight = 0;
  let facialTick = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const deltaMs = now - facialTick;
    facialTick = now;
    updateFacialHurdles(deltaMs);
    const elapsed = (now - phaseStart) / 1000;
    let overhead = 0;
    let stareLight = 0;
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
    } else if (phase === 'facial-happy') {
      const { x, y, z } = facialShot.eyes;
      const amount = reducedMotion ? 1 : ease(Math.min(1, (now - facialShot.start) / 650));
      view(blendPose(facialShot.from, {
        position: [x, y + 0.025, z + 0.83 - 0.36 * hurdles.pressure],
        target: [x, y - 0.04, z], roll: 0, fov: 0.66,
      }, amount));
      overhead = 1 - amount;
      stareLight = 0.15 + hurdles.pressure * 0.4;
    } else if (phase === 'facial-return') {
      const amount = reducedMotion ? 1 : ease(Math.min(1, (now - facialShot.start) / 650));
      view(blendPose(facialShot.from, overheadPose(), amount));
      overhead = amount;
      if (amount === 1) {
        facialShot = undefined;
        phase = 'game';
        match.hidden = false;
        status('Your turn', PIT_CHOICE_HINT);
        updatePitButtons();
        previousWidth = 0;
      }
    } else if (phase === 'loss-stare' || phase === 'game-over') {
      stareLight = poseStare(elapsed);
      if (phase === 'loss-stare' && elapsed >= LOSS_DURATION) {
        phase = 'game-over';
        showResult('Game over');
      }
    } else if (phase === 'book') {
      overhead = 1;
      view(overheadPose());
    } else if (tableShot) {
      const shot = tableShot(now);
      overhead = shot.overhead;
      view(shot.pose);
    } else if (!match.hidden) {
      overhead = 1;
      view(overheadPose());
    }
    room.update(now / 1000, overhead, stareLight);
    upsideDown.update(now, hurdles.active === 'away' ? hurdles.pressure : 0);
    scene.render();
    if (needsLayout) enterMatch();
    if (!match.hidden && (previousWidth !== canvas.clientWidth || previousHeight !== canvas.clientHeight)) {
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
